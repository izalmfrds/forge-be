import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { assertProjectAccess } from "../lib/auth.js";
import { formatRelativeTime, setNoStore } from "../lib/http.js";

const router = Router();

const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  desc: z.string().trim().max(2000).optional().default(""),
  type: z.string().trim().min(1).max(80).optional().default("Project"),
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  desc: z.string().trim().max(2000).optional(),
  type: z.string().trim().min(1).max(80).optional(),
  stage: z.number().int().min(0).max(4).optional(),
  prog: z.number().int().min(0).max(100).optional(),
  live: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

const projectSelect = {
  id: true,
  name: true,
  type: true,
  stage: true,
  prog: true,
  live: true,
  req: true,
  reqVersion: true,
  reqUpdatedAt: true,
  kanbanSyncedVer: true,
  owners: true,
  desc: true,
  updatedAt: true,
} as const;

router.get("/", asyncHandler(async (req, res) => {
  setNoStore(res);
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId: req.auth!.userId } },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      ...projectSelect,
      members: {
        where: { userId: req.auth!.userId },
        select: { role: true },
      },
      _count: { select: { screens: true, kanbanCards: true } },
    },
  });
  return res.json(projects.map(({ members, ...project }) => ({
    ...project,
    role: members[0]?.role,
    updated: formatRelativeTime(project.updatedAt),
  })));
}));

router.post("/", asyncHandler(async (req, res) => {
  const input = projectCreateSchema.parse(req.body);
  const userId = req.auth!.userId;
  const project = await prisma.project.create({
    data: {
      ...input,
      createdBy: userId,
      owners: [userId],
      members: { create: { userId, role: "owner" } },
    },
    select: projectSelect,
  });
  return res.status(201).json({ ...project, role: "owner", updated: "now" });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  setNoStore(res);
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: {
      ...projectSelect,
      screens: {
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, w: true, h: true, updatedAt: true },
      },
      requirements: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true, version: true, prd: true, stories: true, fr: true,
          nfr: true, ac: true, rules: true, sentAt: true, updatedAt: true,
        },
      },
      kanbanCards: {
        orderBy: [{ status: "asc" }, { order: "asc" }],
        select: { id: true, title: true, status: true, canvas: true, reqRef: true, requirementKey: true, requirementVersion: true, obsolete: true, order: true },
      },
    },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  const { requirements, kanbanCards, ...base } = project;
  return res.json({
    ...base,
    updated: formatRelativeTime(project.updatedAt),
    requirement: requirements[0] || null,
    kanban: groupKanbanCards(kanbanCards),
  });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  const input = projectUpdateSchema.parse(req.body);
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: input,
    select: projectSelect,
  });
  return res.json({ ...project, updated: formatRelativeTime(project.updatedAt) });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner"]);
  await prisma.project.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date(), live: false },
  });
  return res.status(204).send();
}));

router.post("/:id/members", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner"]);
  const input = z.object({
    email: z.string().email().transform((value) => value.toLowerCase()),
    role: z.enum(["owner", "editor", "viewer", "member"]).default("member"),
  }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Invitee must register before being added");
  const membership = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.params.id, userId: user.id } },
    create: { projectId: req.params.id, userId: user.id, role: input.role },
    update: { role: input.role },
    select: { id: true, role: true, joinedAt: true, user: { select: { id: true, email: true, name: true } } },
  });
  return res.status(201).json(membership);
}));

export function groupKanbanCards<T extends { status: string }>(cards: T[]) {
  return {
    backlog: cards.filter((card) => card.status === "backlog"),
    todo: cards.filter((card) => card.status === "todo"),
    progress: cards.filter((card) => card.status === "progress"),
    done: cards.filter((card) => card.status === "done"),
  };
}

export default router;
