import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { RequirementData } from "./requirements.js";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_ALLOWED_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

const requirementSchema = z.object({
  prd: z.string().trim().min(1).max(20_000),
  stories: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  fr: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  nfr: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  ac: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  rules: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
});

const geminiOutputSchema = z.object({
  answer: z.string().trim().min(1).max(8_000),
  requirement: requirementSchema,
});

type GeminiInput = {
  project: { name: string; type: string; desc: string };
  prompt: string;
  previousRequirement: RequirementData | null;
  history?: { role: string; text: string }[];
  requestedModel?: string;
};

export type GeminiResult = z.infer<typeof geminiOutputSchema> & {
  model: string;
  provider: "gemini";
};

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function generateWithGemini(input: GeminiInput): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(503, "GEMINI_NOT_CONFIGURED", "Gemini is not configured on the server");
  }

  const model = resolveModel(input.requestedModel);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 45_000));

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: buildContents(input),
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: outputJsonSchema,
        },
      }),
    });

    if (!response.ok) {
      const providerMessage = await readProviderError(response);
      throw new AppError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? "GEMINI_RATE_LIMITED" : "GEMINI_REQUEST_FAILED",
        providerMessage,
      );
    }

    const payload = await response.json() as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) throw new AppError(502, "GEMINI_EMPTY_RESPONSE", "Gemini returned an empty response");

    const parsed = geminiOutputSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new AppError(502, "GEMINI_INVALID_RESPONSE", "Gemini returned an invalid requirement structure");
    }
    return { ...parsed.data, model, provider: "gemini" };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof SyntaxError) {
      throw new AppError(502, "GEMINI_INVALID_JSON", "Gemini returned malformed JSON");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(504, "GEMINI_TIMEOUT", "Gemini did not respond before the timeout");
    }
    throw new AppError(502, "GEMINI_UNAVAILABLE", "Gemini is temporarily unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function resolveModel(requestedModel?: string) {
  const configuredDefault = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!requestedModel || process.env.ALLOW_CLIENT_MODEL_OVERRIDE === "false") return configuredDefault;

  const allowed = new Set(
    (process.env.GEMINI_ALLOWED_MODELS || DEFAULT_ALLOWED_MODELS.join(","))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return allowed.has(requestedModel) ? requestedModel : configuredDefault;
}

function buildContents(input: GeminiInput) {
  const history = (input.history || []).slice(-12).map((message) => ({
    role: message.role === "ai" ? "model" : "user",
    parts: [{ text: message.text.slice(0, 8_000) }],
  }));
  return [
    ...history,
    {
      role: "user",
      parts: [{
        text: JSON.stringify({
          task: "Update the product requirement and answer the user",
          project: input.project,
          currentRequirement: input.previousRequirement,
          userPrompt: input.prompt,
        }),
      }],
    },
  ];
}

async function readProviderError(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    const message = payload.error?.message?.trim();
    if (message) return `Gemini request failed: ${message.slice(0, 500)}`;
  } catch {
    // Do not expose raw provider bodies, request payloads, or credentials.
  }
  return `Gemini request failed with status ${response.status}`;
}

const systemInstruction = `You are Forge's product requirement copilot.
Return only data matching the supplied JSON schema.
Preserve useful existing requirement details unless the user explicitly replaces them.
Use the user's language for the answer and requirement content.
Write specific, testable, non-duplicated requirements.
User stories must follow "As a..., I want..., so that...".
Functional requirements should describe observable system behavior.
Acceptance criteria should be verifiable and preferably use Given/When/Then.
Never include secrets, API keys, markdown fences, or fields outside the schema.`;

const stringArray = { type: "array", items: { type: "string" } } as const;
const outputJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string", description: "A concise response explaining what changed." },
    requirement: {
      type: "object",
      properties: {
        prd: { type: "string" },
        stories: stringArray,
        fr: stringArray,
        nfr: stringArray,
        ac: stringArray,
        rules: stringArray,
      },
      required: ["prd", "stories", "fr", "nfr", "ac", "rules"],
    },
  },
  required: ["answer", "requirement"],
} as const;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};
