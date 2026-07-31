import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";

const router = Router();

router.get("/:id/export", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const format = z.enum(["json"]).default("json").parse(req.query.format);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      members: { select: { role: true, user: { select: { id: true, email: true, name: true } } } },
      requirements: { orderBy: { version: "asc" }, include: { snapshots: true } },
      kanbanCards: { orderBy: [{ status: "asc" }, { order: "asc" }] },
      screens: { orderBy: { createdAt: "asc" }, include: { history: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(project.name)}-forge-export.json"`);
  return res.send(JSON.stringify({
    format: "forge-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
  }, null, format === "json" ? 2 : 0));
}));

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

export default router;
