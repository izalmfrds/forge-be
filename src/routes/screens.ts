import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";

const projectScreensRouter = Router();
const screenRouter = Router();
const defaultSettings = {
  canvasBg: "#f5f5f5",
  canvasBgOpacity: 1,
  showCanvasBg: true,
  showAlignmentGrid: false,
  showRulers: true,
  showMinimap: false,
};

projectScreensRouter.get("/:id/screens", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const screens = await prisma.screen.findMany({
    where: { projectId: req.params.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, w: true, h: true, settings: true, createdAt: true, updatedAt: true },
  });
  return res.json(screens);
}));

projectScreensRouter.post("/:id/screens", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    name: z.string().trim().min(1).max(120),
    w: z.number().int().min(1).max(20000).default(1440),
    h: z.number().int().min(1).max(20000).default(1024),
    settings: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const screen = await prisma.screen.create({
    data: { ...input, settings: (input.settings || defaultSettings) as Prisma.InputJsonValue, projectId: req.params.id, nodes: [], guides: [] },
  });
  return res.status(201).json(screen);
}));

screenRouter.use("/:id", asyncHandler(async (req, _res, next) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  if (!screen) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(screen.projectId, req.auth!.userId);
  return next();
}));

screenRouter.patch("/:id", asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    w: z.number().int().min(1).max(20000).optional(),
    h: z.number().int().min(1).max(20000).optional(),
    settings: z.record(z.unknown()).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  return res.json(await prisma.screen.update({
    where: { id: req.params.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.w !== undefined ? { w: input.w } : {}),
      ...(input.h !== undefined ? { h: input.h } : {}),
      ...(input.settings ? { settings: input.settings as Prisma.InputJsonValue } : {}),
    },
  }));
}));

screenRouter.delete("/:id", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  await prisma.screen.delete({ where: { id: req.params.id } });
  return res.status(204).send();
}));

screenRouter.get("/:id/nodes", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({
    where: { id: req.params.id },
    select: { id: true, nodes: true, guides: true, settings: true, updatedAt: true },
  });
  return res.json(screen);
}));

screenRouter.post("/:id/duplicate", asyncHandler(async (req, res) => {
  const source = await prisma.screen.findUnique({ where: { id: req.params.id } });
  if (!source) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(source.projectId, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  const duplicate = await prisma.screen.create({
    data: {
      projectId: source.projectId,
      name: input.name,
      w: source.w,
      h: source.h,
      nodes: source.nodes as Prisma.InputJsonValue,
      guides: source.guides as Prisma.InputJsonValue,
      settings: source.settings as Prisma.InputJsonValue,
    },
  });
  return res.status(201).json(duplicate);
}));

screenRouter.put("/:id/nodes", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  const nodes = z.array(z.record(z.unknown())).parse(req.body.nodes ?? req.body);
  const updated = await prisma.screen.update({
    where: { id: req.params.id },
    data: { nodes: nodes as Prisma.InputJsonValue },
    select: { id: true, nodes: true, updatedAt: true },
  });
  return res.json(updated);
}));

screenRouter.patch("/:id/nodes", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true, nodes: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    addedNodes: z.array(z.record(z.unknown())).optional().default([]),
    updatedNodes: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
    deletedIds: z.array(z.string()).optional().default([]),
  }).parse(req.body);
  const nodes = patchNodeTree(asNodeArray(screen!.nodes), input);
  const updated = await prisma.screen.update({
    where: { id: req.params.id },
    data: { nodes: nodes as Prisma.InputJsonValue },
    select: { id: true, nodes: true, updatedAt: true },
  });
  return res.json(updated);
}));

screenRouter.put("/:screenId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.screenId }, select: { projectId: true, nodes: true } });
  if (!screen) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(screen.projectId, req.auth!.userId, ["owner", "editor"]);
  const replacement = z.object({ id: z.string() }).passthrough().parse({ ...req.body, id: req.params.nodeId }) as CanvasNode;
  const nodes = replaceNode(asNodeArray(screen.nodes), req.params.nodeId, replacement);
  if (!nodes.changed) throw new AppError(404, "NODE_NOT_FOUND", "Canvas node not found");
  await prisma.screen.update({ where: { id: req.params.screenId }, data: { nodes: nodes.items as Prisma.InputJsonValue } });
  return res.json(replacement);
}));

screenRouter.patch("/:screenId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.screenId }, select: { projectId: true, nodes: true } });
  if (!screen) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(screen.projectId, req.auth!.userId, ["owner", "editor"]);
  const patch = z.record(z.unknown()).parse(req.body);
  const nodes = updateNode(asNodeArray(screen.nodes), req.params.nodeId, patch);
  if (!nodes.changed) throw new AppError(404, "NODE_NOT_FOUND", "Canvas node not found");
  await prisma.screen.update({ where: { id: req.params.screenId }, data: { nodes: nodes.items as Prisma.InputJsonValue } });
  return res.json(nodes.node);
}));

screenRouter.delete("/:screenId/nodes/:nodeId", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.screenId }, select: { projectId: true, nodes: true } });
  if (!screen) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(screen.projectId, req.auth!.userId, ["owner", "editor"]);
  const nodes = deleteNode(asNodeArray(screen.nodes), req.params.nodeId);
  if (!nodes.changed) throw new AppError(404, "NODE_NOT_FOUND", "Canvas node not found");
  await prisma.screen.update({ where: { id: req.params.screenId }, data: { nodes: nodes.items as Prisma.InputJsonValue } });
  return res.status(204).send();
}));

screenRouter.post("/:screenId/nodes/:nodeId/duplicate", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.screenId }, select: { projectId: true, nodes: true } });
  if (!screen) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  await assertProjectAccess(screen.projectId, req.auth!.userId, ["owner", "editor"]);
  const result = duplicateNode(asNodeArray(screen.nodes), req.params.nodeId);
  if (!result.node) throw new AppError(404, "NODE_NOT_FOUND", "Canvas node not found");
  await prisma.screen.update({ where: { id: req.params.screenId }, data: { nodes: result.items as Prisma.InputJsonValue } });
  return res.status(201).json(result.node);
}));

screenRouter.put("/:id/guides", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  const guides = z.array(z.object({
    id: z.string(),
    orientation: z.enum(["horizontal", "vertical"]),
    position: z.number(),
  })).parse(req.body.guides);
  return res.json(await prisma.screen.update({
    where: { id: req.params.id },
    data: { guides },
    select: { id: true, guides: true, updatedAt: true },
  }));
}));

screenRouter.get("/:id/history", asyncHandler(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
  const history = await prisma.canvasHistory.findMany({
    where: { screenId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return res.json(history);
}));

screenRouter.post("/:id/history", asyncHandler(async (req, res) => {
  const screen = await prisma.screen.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await assertProjectAccess(screen!.projectId, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    action: z.string().min(1).max(80),
    payload: z.unknown(),
    inverse: z.unknown(),
    affectedIds: z.array(z.string()).default([]),
  }).parse(req.body);
  const entry = await prisma.canvasHistory.create({
    data: {
      screenId: req.params.id,
      action: input.action,
      payload: input.payload as Prisma.InputJsonValue,
      inverse: input.inverse as Prisma.InputJsonValue,
      affectedIds: input.affectedIds,
    },
  });
  return res.status(201).json(entry);
}));

type CanvasNode = Record<string, unknown> & { id: string; children?: CanvasNode[] };

function asNodeArray(value: unknown): CanvasNode[] {
  return Array.isArray(value) ? value.filter((item): item is CanvasNode => !!item && typeof item === "object" && typeof (item as CanvasNode).id === "string") : [];
}

function patchNodeTree(nodes: CanvasNode[], input: { addedNodes: Record<string, unknown>[]; updatedNodes: ({ id: string } & Record<string, unknown>)[]; deletedIds: string[] }) {
  let result = nodes;
  input.updatedNodes.forEach((patch) => { result = updateNode(result, patch.id, patch).items; });
  input.deletedIds.forEach((id) => { result = deleteNode(result, id).items; });
  return [...result, ...input.addedNodes.filter((node): node is CanvasNode => typeof node.id === "string")];
}

function updateNode(nodes: CanvasNode[], id: string, patch: Record<string, unknown>): { items: CanvasNode[]; node?: CanvasNode; changed: boolean } {
  let changed = false;
  let updatedNode: CanvasNode | undefined;
  const items = nodes.map((node) => {
    if (node.id === id) {
      changed = true;
      updatedNode = { ...node, ...patch, id: node.id };
      return updatedNode;
    }
    if (node.children) {
      const childResult = updateNode(node.children, id, patch);
      if (childResult.changed) {
        changed = true;
        updatedNode = childResult.node;
        return { ...node, children: childResult.items };
      }
    }
    return node;
  });
  return { items, node: updatedNode, changed };
}

function replaceNode(nodes: CanvasNode[], id: string, replacement: CanvasNode): { items: CanvasNode[]; changed: boolean } {
  let changed = false;
  const items = nodes.map((node) => {
    if (node.id === id) {
      changed = true;
      return replacement;
    }
    if (node.children) {
      const childResult = replaceNode(node.children, id, replacement);
      if (childResult.changed) {
        changed = true;
        return { ...node, children: childResult.items };
      }
    }
    return node;
  });
  return { items, changed };
}

function deleteNode(nodes: CanvasNode[], id: string): { items: CanvasNode[]; changed: boolean } {
  let changed = false;
  const items = nodes.flatMap((node) => {
    if (node.id === id) {
      changed = true;
      return [];
    }
    if (node.children) {
      const childResult = deleteNode(node.children, id);
      if (childResult.changed) {
        changed = true;
        return [{ ...node, children: childResult.items }];
      }
    }
    return [node];
  });
  return { items, changed };
}

function duplicateNode(nodes: CanvasNode[], id: string): { items: CanvasNode[]; node?: CanvasNode } {
  let duplicate: CanvasNode | undefined;
  const clone = (node: CanvasNode): CanvasNode => ({
    ...node,
    id: `node_${crypto.randomUUID()}`,
    x: typeof node.x === "number" ? node.x + 16 : node.x,
    y: typeof node.y === "number" ? node.y + 16 : node.y,
    children: node.children?.map(clone),
  });
  const visit = (items: CanvasNode[]): CanvasNode[] => {
    const output: CanvasNode[] = [];
    items.forEach((node) => {
      if (node.id === id) {
        duplicate = clone(node);
        output.push(node, duplicate);
      } else {
        output.push(node.children ? { ...node, children: visit(node.children) } : node);
      }
    });
    return output;
  };
  return { items: visit(nodes), node: duplicate };
}

export { screenRouter };
export default projectScreensRouter;
