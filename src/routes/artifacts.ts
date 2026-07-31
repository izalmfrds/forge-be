import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { artifactKinds } from "../services/artifacts.js";
import { generateProjectArtifacts } from "../services/orchestrator.js";

const router = Router();
const kindSchema = z.enum(artifactKinds);

router.get("/:id/artifacts", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const artifacts = await prisma.canvasArtifact.findMany({ where: { projectId: req.params.id }, orderBy: { kind: "asc" } });
  return res.json(artifacts);
}));

router.get("/:id/artifacts/bundle", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, name: true, reqVersion: true, artifacts: { orderBy: { kind: "asc" } } },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  return res.json({
    format: "forge-artifact-bundle",
    version: 1,
    project: { id: project.id, name: project.name, requirementVersion: project.reqVersion || 0 },
    exportedAt: new Date().toISOString(),
    artifacts: project.artifacts,
  });
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
  const result = await generateProjectArtifacts(req.params.id, requestedKinds);
  return res.json(result.artifacts);
}));

export default router;
