import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const input = z.object({
    q: z.string().trim().min(1).max(200),
    projectId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  }).parse(req.query);
  const accessibleProjects = await prisma.projectMember.findMany({
    where: {
      userId: req.auth!.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      project: { deletedAt: null },
    },
    select: { projectId: true },
  });
  const projectIds = accessibleProjects.map((membership) => membership.projectId);
  if (!projectIds.length) return res.json([]);

  const [projects, screens, requirements] = await Promise.all([
    prisma.project.findMany({
      where: {
        id: { in: projectIds },
        OR: [{ name: { contains: input.q, mode: "insensitive" } }, { desc: { contains: input.q, mode: "insensitive" } }],
      },
      take: input.limit,
      select: { id: true, name: true, desc: true },
    }),
    prisma.screen.findMany({
      where: { projectId: { in: projectIds }, name: { contains: input.q, mode: "insensitive" } },
      take: input.limit,
      select: { id: true, projectId: true, name: true },
    }),
    prisma.requirement.findMany({
      where: { projectId: { in: projectIds }, prd: { contains: input.q, mode: "insensitive" } },
      orderBy: { version: "desc" },
      take: input.limit,
      select: { id: true, projectId: true, version: true, prd: true },
    }),
  ]);
  const results = [
    ...projects.map((item) => ({ kind: "project", ...item })),
    ...screens.map((item) => ({ kind: "screen", ...item })),
    ...requirements.map((item) => ({ kind: "requirement", ...item })),
  ].slice(0, input.limit);
  return res.json(results);
}));

export default router;
