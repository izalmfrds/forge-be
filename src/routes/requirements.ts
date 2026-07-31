import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { assertProjectAccess } from "../lib/auth.js";
import { createRequirementDraft, mergeRequirement, requirementToCards, type RequirementData } from "../services/requirements.js";

const router = Router();

const requirementSelect = {
  id: true, version: true, prd: true, stories: true, fr: true,
  nfr: true, ac: true, rules: true, sentAt: true, createdAt: true, updatedAt: true,
} as const;

router.get("/:id/requirement", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const requirements = await prisma.requirement.findMany({
    where: { projectId: req.params.id },
    orderBy: { version: "desc" },
    select: {
      ...requirementSelect,
      snapshots: { orderBy: { sentAt: "desc" }, select: { id: true, version: true, requirementData: true, sentAt: true } },
    },
  });
  return res.json({ current: requirements[0] || null, history: requirements });
}));

router.post("/:id/requirement", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    prompt: z.string().trim().max(12000).optional().default(""),
    forceNew: z.boolean().optional().default(false),
    requirement: z.object({
      prd: z.string(),
      stories: z.array(z.string()),
      fr: z.array(z.string()),
      nfr: z.array(z.string()),
      ac: z.array(z.string()),
      rules: z.array(z.string()),
    }).optional(),
  }).parse(req.body);
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { requirements: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");

  const current = project.requirements[0];
  const currentData = current ? toRequirementData(current) : null;
  const data = input.requirement
    || (!currentData || input.forceNew
      ? createRequirementDraft(project, input.prompt)
      : mergeRequirement(currentData, input.prompt));
  const version = (project.reqVersion || 0) + 1;
  const requirement = await prisma.$transaction(async (tx) => {
    const created = await tx.requirement.create({
      data: {
        projectId: project.id,
        version,
        prd: data.prd,
        stories: data.stories,
        fr: data.fr,
        nfr: data.nfr,
        ac: data.ac,
        rules: data.rules,
      },
      select: requirementSelect,
    });
    await tx.project.update({
      where: { id: project.id },
      data: { req: true, reqVersion: version, reqUpdatedAt: new Date() },
    });
    return created;
  });
  return res.status(current ? 200 : 201).json(requirement);
}));

router.post("/:id/requirement/send-to-kanban", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  return res.json(await syncRequirementToKanban(req.params.id));
}));

export async function syncRequirementToKanban(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { requirements: { orderBy: { version: "desc" }, take: 1 } },
  });
  const requirement = project?.requirements[0];
  if (!project || !requirement) throw new AppError(404, "REQUIREMENT_NOT_FOUND", "Requirement not found");
  const data = toRequirementData(requirement);
  const generated = requirementToCards(data);

  return prisma.$transaction(async (tx) => {
    await tx.requirementSnapshot.upsert({
      where: { requirementId_version: { requirementId: requirement.id, version: requirement.version } },
      create: {
        requirementId: requirement.id,
        version: requirement.version,
        requirementData: data as unknown as Prisma.InputJsonValue,
      },
      update: { requirementData: data as unknown as Prisma.InputJsonValue, sentAt: new Date() },
    });
    const existing = await tx.kanbanCard.findMany({ where: { projectId: project.id } });
    const byKey = new Map(existing.filter((card) => card.requirementKey).map((card) => [card.requirementKey!, card]));
    const legacyByTitle = new Map(existing.filter((card) => !card.requirementKey).map((card) => [card.title, card]));
    const activeKeys = new Set(generated.map((card) => card.requirementKey));
    const nextOrder = new Map<string, number>();
    for (const status of ["backlog", "todo", "progress", "done"]) {
      nextOrder.set(status, existing.filter((card) => card.status === status).reduce((max, card) => Math.max(max, card.order + 1), 0));
    }
    let added = 0;
    let updated = 0;
    for (const card of generated) {
      const current = byKey.get(card.requirementKey) || legacyByTitle.get(card.title);
      if (!current) {
        await tx.kanbanCard.create({
          data: {
            ...card,
            projectId: project.id,
            requirementVersion: requirement.version,
            order: nextOrder.get(card.status) || 0,
          },
        });
        nextOrder.set(card.status, (nextOrder.get(card.status) || 0) + 1);
        added += 1;
        continue;
      }
      const changed = current.title !== card.title
        || current.canvas !== card.canvas
        || current.reqRef !== card.reqRef
        || current.obsolete;
      await tx.kanbanCard.update({
        where: { id: current.id },
        data: {
          title: card.title,
          canvas: card.canvas,
          reqRef: card.reqRef,
          requirementKey: card.requirementKey,
          requirementVersion: requirement.version,
          obsolete: false,
        },
      });
      if (changed) updated += 1;
    }
    const removed = existing.filter((card) => card.requirementKey && !activeKeys.has(card.requirementKey) && !card.obsolete);
    if (removed.length) {
      await tx.kanbanCard.updateMany({ where: { id: { in: removed.map((card) => card.id) } }, data: { obsolete: true } });
    }
    await tx.requirement.update({ where: { id: requirement.id }, data: { sentAt: new Date() } });
    await tx.project.update({ where: { id: project.id }, data: { kanbanSyncedVer: requirement.version } });
    return { added, updated, obsolete: removed.length, version: requirement.version };
  });
}

export function toRequirementData(requirement: { prd: string; stories: unknown; fr: unknown; nfr: unknown; ac: unknown; rules: unknown }): RequirementData {
  const strings = (value: unknown) => Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : String((item as { text?: unknown })?.text || "")).filter(Boolean)
    : [];
  return {
    prd: requirement.prd,
    stories: strings(requirement.stories),
    fr: strings(requirement.fr),
    nfr: strings(requirement.nfr),
    ac: strings(requirement.ac),
    rules: strings(requirement.rules),
  };
}

export default router;
