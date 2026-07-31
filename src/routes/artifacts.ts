import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { artifactKinds, generateArtifacts, type ArtifactKind } from "../services/artifacts.js";

const router = Router();
const kindSchema = z.enum(artifactKinds);

router.get("/:id/artifacts", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const artifacts = await prisma.canvasArtifact.findMany({ where: { projectId: req.params.id }, orderBy: { kind: "asc" } });
  return res.json(artifacts);
}));

router.get("/:id/artifacts/:kind", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const kind = kindSchema.parse(req.params.kind);
  const artifact = await prisma.canvasArtifact.findUnique({ where: { projectId_kind: { projectId: req.params.id, kind } } });
  if (!artifact) throw new AppError(404, "ARTIFACT_NOT_FOUND", "Artifact canvas has not been generated yet");
  return res.json(artifact);
}));

router.post("/:id/artifacts/orchestrate", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  const requestedKinds = z.object({ kinds: z.array(kindSchema).min(1).max(4).optional() }).parse(req.body || {}).kinds;
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, deletedAt: null },
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
  const selected = requestedKinds ? generated.filter((artifact) => requestedKinds.includes(artifact.kind)) : generated;
  const artifacts = await prisma.$transaction(selected.map((artifact) => prisma.canvasArtifact.upsert({
    where: { projectId_kind: { projectId: project.id, kind: artifact.kind } },
    create: { projectId: project.id, kind: artifact.kind, requirementVersion: requirement.version, content: artifact.content as unknown as Prisma.InputJsonValue },
    update: { requirementVersion: requirement.version, status: "synced", content: artifact.content as unknown as Prisma.InputJsonValue },
  })));
  await prisma.project.update({ where: { id: project.id }, data: { stage: Math.max(project.stage, 2), prog: Math.max(project.prog, 50) } });
  return res.json(artifacts);
}));

function asStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : String((item as { text?: unknown })?.text || "")).filter(Boolean) : [];
}

export default router;
