import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { groupKanbanCards } from "./projects.js";
import { syncRequirementToKanban } from "./requirements.js";

const projectKanbanRouter = Router();
const cardRouter = Router();
const statuses = ["backlog", "todo", "progress", "done"] as const;

projectKanbanRouter.get("/:id/kanban", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const status = z.enum(statuses).optional().parse(req.query.status);
  const cards = await prisma.kanbanCard.findMany({
    where: { projectId: req.params.id, ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { order: "asc" }],
  });
  return res.json(status ? cards : groupKanbanCards(cards));
}));

projectKanbanRouter.post("/:id/kanban/sync", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  return res.json(await syncRequirementToKanban(req.params.id));
}));

const createCardSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  status: z.enum(statuses).default("backlog"),
  canvas: z.string().trim().max(50).nullable().optional(),
  reqRef: z.string().trim().max(80).nullable().optional(),
});

cardRouter.post("/", asyncHandler(async (req, res) => {
  const input = createCardSchema.parse(req.body);
  await assertProjectAccess(input.projectId, req.auth!.userId, ["owner", "editor"]);
  const count = await prisma.kanbanCard.count({ where: { projectId: input.projectId, status: input.status } });
  const card = await prisma.kanbanCard.create({ data: { ...input, order: count } });
  return res.status(201).json(card);
}));

cardRouter.patch("/:cardId", asyncHandler(async (req, res) => {
  const current = await prisma.kanbanCard.findUnique({ where: { id: req.params.cardId } });
  if (!current) throw new AppError(404, "CARD_NOT_FOUND", "Kanban card not found");
  await assertProjectAccess(current.projectId, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    title: z.string().trim().min(1).max(300).optional(),
    status: z.enum(statuses).optional(),
    canvas: z.string().trim().max(50).nullable().optional(),
    reqRef: z.string().trim().max(80).nullable().optional(),
    order: z.number().int().min(0).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const card = await prisma.kanbanCard.update({ where: { id: current.id }, data: input });
  return res.json(card);
}));

cardRouter.delete("/:cardId", asyncHandler(async (req, res) => {
  const card = await prisma.kanbanCard.findUnique({ where: { id: req.params.cardId } });
  if (!card) throw new AppError(404, "CARD_NOT_FOUND", "Kanban card not found");
  await assertProjectAccess(card.projectId, req.auth!.userId, ["owner", "editor"]);
  await prisma.kanbanCard.delete({ where: { id: card.id } });
  return res.status(204).send();
}));

export { cardRouter };
export default projectKanbanRouter;
