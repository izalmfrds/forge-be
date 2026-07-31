import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { artifactKinds, type ArtifactKind } from "../services/artifacts.js";
import { completeCanvasTasks, generateProjectArtifacts } from "../services/orchestrator.js";
import { AppError } from "../lib/errors.js";

const router = Router();
const kindSchema = z.enum(artifactKinds);

router.get("/:id/orchestration/runs", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  const limit = z.coerce.number().int().min(1).max(50).default(10).parse(req.query.limit);
  return res.json(await prisma.orchestrationRun.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: "desc" }, take: limit }));
}));

router.get("/:id/orchestration/latest", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId);
  return res.json(await prisma.orchestrationRun.findFirst({ where: { projectId: req.params.id }, orderBy: { createdAt: "desc" } }));
}));

router.post("/:id/orchestration/run", asyncHandler(async (req, res) => {
  await assertProjectAccess(req.params.id, req.auth!.userId, ["owner", "editor"]);
  const input = z.object({
    trigger: z.enum(["automatic", "manual", "retry"]).default("automatic"),
    kinds: z.array(kindSchema).min(1).max(4).optional(),
  }).parse(req.body || {});
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { reqVersion: true } });
  const requirementVersion = project?.reqVersion || 0;
  const kinds = (input.kinds || artifactKinds) as ArtifactKind[];
  const existing = await prisma.orchestrationRun.findFirst({
    where: { projectId: req.params.id, requirementVersion, status: "running" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return res.status(202).json(existing);

  const startedAt = new Date();
  const initialSteps: RunStep[] = [
    { key: "requirement", label: `Read Requirement v${requirementVersion}`, status: "running", startedAt: startedAt.toISOString() },
    ...kinds.map((kind) => ({ key: kind, label: `Generate ${kind} artifact`, status: "pending" as const })),
    { key: "verification", label: "Run artifact quality gates", status: "pending" },
    { key: "kanban", label: "Update linked Kanban tasks", status: "pending" },
  ];
  const run = await prisma.orchestrationRun.create({
    data: { projectId: req.params.id, requirementVersion, trigger: input.trigger, steps: initialSteps as unknown as Prisma.InputJsonValue },
  });

  let currentSteps = initialSteps;
  try {
    const generated = await generateProjectArtifacts(req.params.id, kinds);
    const completedAt = new Date().toISOString();
    currentSteps = [
      { ...initialSteps[0], status: "completed", completedAt },
      ...kinds.map((kind) => {
        const artifact = generated.artifacts.find((item) => item.kind === kind);
        const content = artifact?.content as { files?: unknown[] } | undefined;
        return { key: kind, label: `Generate ${kind} artifact`, status: "completed" as const, fileCount: content?.files?.length || 0, completedAt };
      }),
      {
        key: "verification",
        label: "Run artifact quality gates",
        status: generated.verificationPassed ? "completed" : "failed",
        checkCount: generated.artifacts.reduce((count, artifact) => count + (((artifact.content as { quality?: { checks?: unknown[] } }).quality?.checks?.length) || 0), 0),
        completedAt,
        ...(!generated.verificationPassed ? { error: "One or more generated artifacts failed verification" } : {}),
      },
      { key: "kanban", label: "Update linked Kanban tasks", status: "pending" },
    ];
    if (!generated.verificationPassed) throw new AppError(422, "ARTIFACT_VERIFICATION_FAILED", "Generated artifacts did not pass quality gates");
    const taskIds = await completeCanvasTasks(req.params.id, kinds);
    currentSteps[currentSteps.length - 1] = { key: "kanban", label: "Update linked Kanban tasks", status: "completed", taskCount: taskIds.length, completedAt };
    const cards = await prisma.kanbanCard.findMany({ where: { projectId: req.params.id, obsolete: false }, select: { status: true } });
    const done = cards.filter((card) => card.status === "done").length;
    const progress = cards.length ? Math.round((done / cards.length) * 100) : 50;
    const [completed] = await prisma.$transaction([
      prisma.orchestrationRun.update({ where: { id: run.id }, data: { status: "completed", steps: currentSteps as unknown as Prisma.InputJsonValue, completedAt: new Date() } }),
      prisma.project.update({ where: { id: req.params.id }, data: { prog: Math.max(50, progress), stage: progress === 100 ? 3 : 2 } }),
    ]);
    return res.status(201).json(completed);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Orchestration failed";
    const failedSteps = currentSteps.map((step) => step.status === "running" ? { ...step, status: "failed", error: message, completedAt: new Date().toISOString() } : step);
    await prisma.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: message, steps: failedSteps as unknown as Prisma.InputJsonValue, completedAt: new Date() } });
    throw error;
  }
}));

type RunStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  fileCount?: number;
  taskCount?: number;
  checkCount?: number;
  error?: string;
};

export default router;
