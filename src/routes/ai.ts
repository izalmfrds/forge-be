import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { assertProjectAccess } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { createRequirementDraft, mergeRequirement, type RequirementData } from "../services/requirements.js";
import { generateWithGemini, isGeminiConfigured } from "../services/gemini.js";
import { toRequirementData } from "./requirements.js";

const router = Router();
const rateBuckets = new Map<string, number[]>();

router.use((req, _res, next) => {
  const key = req.auth!.userId;
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => timestamp > now - 60_000);
  if (recent.length >= Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20)) {
    return next(new AppError(429, "RATE_LIMITED", "Too many AI requests; try again in a minute"));
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return next();
});

const chatSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().trim().min(1).max(12000),
  model: z.string().trim().max(120).optional(),
  attachments: z.record(z.number().int().min(0).max(20)).optional(),
});

router.get("/chat/:projectId", asyncHandler(async (req, res) => {
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  }).parse(req.query);
  await assertProjectAccess(req.params.projectId, req.auth!.userId);

  const messages = await prisma.chatMessage.findMany({
    where: { projectId: req.params.projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, role: true, text: true, model: true, createdAt: true },
  });
  const hasMore = messages.length > query.limit;
  const page = messages.slice(0, query.limit);

  return res.json({
    items: page.reverse().map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      model: message.model,
      at: message.createdAt.getTime(),
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id || null : null,
  });
}));

router.post("/chat", asyncHandler(async (req, res) => {
  const input = chatSchema.parse(req.body);
  await assertProjectAccess(input.projectId, req.auth!.userId, ["owner", "editor"]);
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: {
      requirements: { orderBy: { version: "desc" }, take: 1 },
      chatMessages: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");

  const previous = project.requirements[0] ? toRequirementData(project.requirements[0]) : null;
  const ai = await createAiResult({
    project,
    prompt: input.text,
    previous,
    requestedModel: input.model,
    history: project.chatMessages.reverse().map((message) => ({ role: message.role, text: message.text })),
  });
  const version = (project.reqVersion || 0) + 1;
  const result = await persistAiResult({
    projectId: project.id,
    userId: req.auth!.userId,
    model: ai.model,
    prompt: input.text,
    answer: ai.answer,
    version,
    requirement: ai.requirement,
    mode: ai.mode,
  });
  return res.json(result);
}));

router.post("/generate-requirement", asyncHandler(async (req, res) => {
  const input = chatSchema.parse(req.body);
  await assertProjectAccess(input.projectId, req.auth!.userId, ["owner", "editor"]);
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { requirements: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  const previous = project.requirements[0] ? toRequirementData(project.requirements[0]) : null;
  const ai = await createAiResult({ project, prompt: input.text, previous, requestedModel: input.model });
  return res.json({ ...ai.requirement, answer: ai.answer, model: ai.model, mode: ai.mode });
}));

async function persistAiResult(input: {
  projectId: string;
  userId: string;
  model?: string;
  prompt: string;
  answer: string;
  version: number;
  requirement: RequirementData;
  mode: "gemini" | "local";
}) {
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.requirement.create({
      data: {
        projectId: input.projectId,
        version: input.version,
        prd: input.requirement.prd,
        stories: input.requirement.stories,
        fr: input.requirement.fr,
        nfr: input.requirement.nfr,
        ac: input.requirement.ac,
        rules: input.requirement.rules,
      },
    });
    await tx.project.update({
      where: { id: input.projectId },
      data: { req: true, reqVersion: input.version, reqUpdatedAt: new Date() },
    });
    const messages = await Promise.all([
      tx.chatMessage.create({
        data: { projectId: input.projectId, userId: input.userId, role: "user", text: input.prompt, model: input.model },
      }),
      tx.chatMessage.create({
        data: { projectId: input.projectId, userId: input.userId, role: "ai", text: input.answer, model: input.model },
      }),
    ]);
    return { created, messages };
  });
  return {
    role: "ai",
    text: input.answer,
    requirement: result.created,
    history: result.messages.map((message) => ({ role: message.role, text: message.text, at: message.createdAt.getTime() })),
    mode: input.mode,
    model: input.model,
  };
}

async function createAiResult(input: {
  project: { name: string; type: string; desc: string };
  prompt: string;
  previous: RequirementData | null;
  requestedModel?: string;
  history?: { role: string; text: string }[];
}) {
  if (isGeminiConfigured()) {
    try {
      const result = await generateWithGemini({
        project: input.project,
        prompt: input.prompt,
        previousRequirement: input.previous,
        requestedModel: input.requestedModel,
        history: input.history,
      });
      return { ...result, mode: "gemini" as const };
    } catch (error) {
      if (process.env.AI_FALLBACK_MODE !== "true") throw error;
    }
  }

  const requirement = input.previous
    ? mergeRequirement(input.previous, input.prompt)
    : createRequirementDraft(input.project, input.prompt);
  return {
    answer: localAiReply(input.project.name, input.prompt, requirement),
    requirement,
    model: "local-requirement-engine",
    provider: "local" as const,
    mode: "local" as const,
  };
}

function localAiReply(projectName: string, prompt: string, requirement: RequirementData) {
  const lower = prompt.toLowerCase();
  if (lower.includes("prd") || lower.includes("brief")) {
    return `The PRD for ${projectName} has been updated. It now contains ${requirement.stories.length} user stories and ${requirement.fr.length} functional requirements.`;
  }
  if (lower.includes("impact")) {
    return `Impact analysis captured for ${projectName}. Review the updated requirement before synchronizing it to Kanban.`;
  }
  return `Captured your update for ${projectName}. The new requirement version is ready for review and Kanban synchronization.`;
}

export default router;
