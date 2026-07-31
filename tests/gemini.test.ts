import assert from "node:assert/strict";
import test from "node:test";
import { generateWithGemini, isGeminiConfigured } from "../src/services/gemini.js";

const requirement = {
  prd: "A focused product requirement.",
  stories: ["As a user, I want to sign in so that I can access my account."],
  fr: ["The system shall authenticate users."],
  nfr: ["Authentication responses should complete within two seconds."],
  ac: ["Given valid credentials, when submitted, then the user is signed in."],
  rules: ["Only active users may sign in."],
};

test("Gemini configuration requires a non-empty server key", () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.equal(isGeminiConfigured(), false);
  process.env.GEMINI_API_KEY = "test-key";
  assert.equal(isGeminiConfigured(), true);
  restore("GEMINI_API_KEY", previous);
});

test("Gemini adapter validates structured output and keeps the key in a header", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "server-secret";
  process.env.GEMINI_MODEL = "gemini-2.5-flash-lite";

  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /gemini-2\.5-flash-lite:generateContent$/);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "server-secret");
    assert.doesNotMatch(String(url), /server-secret/);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "Requirement updated.", requirement }) }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await generateWithGemini({
      project: { name: "Atlas", type: "Web App", desc: "Authentication workspace" },
      prompt: "Create the login requirement",
      previousRequirement: null,
    });
    assert.equal(result.provider, "gemini");
    assert.equal(result.requirement.prd, requirement.prd);
  } finally {
    globalThis.fetch = originalFetch;
    restore("GEMINI_API_KEY", previousKey);
    restore("GEMINI_MODEL", previousModel);
  }
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
