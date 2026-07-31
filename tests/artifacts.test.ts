import assert from "node:assert/strict";
import test from "node:test";
import { generateArtifacts } from "../src/services/artifacts.js";
import { verifyArtifact } from "../src/services/verification.js";

test("artifact orchestration creates every engineering canvas and links matching tasks", () => {
  const artifacts = generateArtifacts({ name: "Atlas", desc: "Workspace" }, {
    prd: "Atlas workspace",
    stories: ["As a user, I want a login form so that I can enter."],
    fr: ["The API shall authenticate users.", "The system shall persist projects."],
    nfr: ["Accessibility: meet WCAG AA."],
    ac: ["Given valid credentials, when submitted, then open the workspace."],
    rules: ["Only owners may delete projects."],
  }, [
    { id: "front-1", title: "Build login", canvas: "frontend", status: "todo", reqRef: "Story 1" },
    { id: "back-1", title: "Add auth API", canvas: "backend", status: "progress", reqRef: "FR 1" },
  ]);

  assert.deepEqual(artifacts.map((artifact) => artifact.kind), ["frontend", "backend", "database", "testing"]);
  assert.equal(artifacts.find((artifact) => artifact.kind === "frontend")?.content.tasks[0]?.id, "front-1");
  assert.equal(artifacts.find((artifact) => artifact.kind === "frontend")?.content.files[0]?.path, "src/app/page.tsx");
  assert.match(artifacts.find((artifact) => artifact.kind === "database")?.content.files[0]?.content || "", /model Project/);
  assert.match(artifacts.find((artifact) => artifact.kind === "testing")?.content.sections[0]?.items[0] || "", /valid credentials/i);
});

test("artifact verification rejects leaked secrets and unsafe paths", () => {
  const report = verifyArtifact("backend", {
    summary: "Backend",
    sections: [{ title: "One", items: [] }, { title: "Two", items: [] }, { title: "Three", items: [] }],
    tasks: [],
    files: [
      { path: "src/routes/project.ts", language: "typescript", content: "export default {};" },
      { path: "../.env", language: "dotenv", content: "GEMINI_API_KEY=AQ.this-is-a-secret-key-value" },
    ],
  });
  assert.equal(report.status, "failed");
  assert.equal(report.checks.find((item) => item.key === "paths")?.passed, false);
  assert.equal(report.checks.find((item) => item.key === "secrets")?.passed, false);
});

test("artifact verification permits empty environment placeholders", () => {
  const report = verifyArtifact("backend", {
    summary: "Backend",
    sections: [{ title: "One", items: [] }, { title: "Two", items: [] }, { title: "Three", items: [] }],
    tasks: [],
    files: [
      { path: "src/routes/project.ts", language: "typescript", content: "export default {};" },
      { path: ".env.example", language: "dotenv", content: "DATABASE_URL=\nGEMINI_API_KEY=\nFRONTEND_URL=http://localhost:3000\n" },
    ],
  });
  assert.equal(report.status, "passed");
});
