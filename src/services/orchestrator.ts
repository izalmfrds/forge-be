import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { artifactKinds, generateArtifacts, type ArtifactKind } from "./artifacts.js";
import { verifyArtifact } from "./verification.js";

export async function generateProjectArtifacts(projectId: string, requestedKinds?: ArtifactKind[]) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      requirements: { orderBy: { version: "desc" }, take: 1 },
      kanbanCards: { where: { obsolete: false }, orderBy: [{ status: "asc" }, { order: "asc" }] },
    },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  const requirement = project.requirements[0];
  if (!requirement) throw new AppError(409, "REQUIREMENT_REQUIRED", "Create a requirement before orchestrating artifact canvases");
  const generated = generateArtifacts({ name: project.name, desc: project.desc }, {
    prd: requirement.prd,
    stories: asStrings(requirement.stories),
    fr: asStrings(requirement.fr),
    nfr: asStrings(requirement.nfr),
    ac: asStrings(requirement.ac),
    rules: asStrings(requirement.rules),
  }, project.kanbanCards);
  const selected = (requestedKinds ? generated.filter((artifact) => requestedKinds.includes(artifact.kind)) : generated).map((artifact) => {
    const quality = verifyArtifact(artifact.kind, artifact.content);
    return { ...artifact, content: { ...artifact.content, quality }, verified: quality.status === "passed" };
  });
  const artifacts = await prisma.$transaction(selected.map((artifact) => prisma.canvasArtifact.upsert({
    where: { projectId_kind: { projectId: project.id, kind: artifact.kind } },
    create: { projectId: project.id, kind: artifact.kind, requirementVersion: requirement.version, status: artifact.verified ? "verified" : "failed", content: artifact.content as unknown as Prisma.InputJsonValue },
    update: { requirementVersion: requirement.version, status: artifact.verified ? "verified" : "failed", content: artifact.content as unknown as Prisma.InputJsonValue },
  })));
  await prisma.project.update({ where: { id: project.id }, data: { stage: Math.max(project.stage, 2), prog: Math.max(project.prog, 50) } });
  return { project, requirement, artifacts, kinds: selected.map((artifact) => artifact.kind), verificationPassed: selected.every((artifact) => artifact.verified) };
}

export async function completeCanvasTasks(projectId: string, kinds: ArtifactKind[]) {
  const cards = await prisma.kanbanCard.findMany({ where: { projectId }, orderBy: [{ status: "asc" }, { order: "asc" }] });
  const targetIds = new Set(cards.filter((card) => !card.obsolete && card.canvas && kinds.includes(card.canvas as ArtifactKind)).map((card) => card.id));
  const next = cards.map((card) => targetIds.has(card.id) ? { ...card, status: "done" } : card);
  const updates: { id: string; status: string; order: number }[] = [];
  for (const status of ["backlog", "todo", "progress", "done"]) {
    next.filter((card) => card.status === status).forEach((card, order) => updates.push({ id: card.id, status, order }));
  }
  if (updates.length) {
    await prisma.$transaction(updates.map((card) => prisma.kanbanCard.update({ where: { id: card.id }, data: { status: card.status, order: card.order } })));
  }
  return [...targetIds];
}

export function orchestrationKinds() {
  return [...artifactKinds];
}

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : String((item as { text?: unknown })?.text || "")).filter(Boolean) : [];
}
