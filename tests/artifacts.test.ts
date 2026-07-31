import assert from "node:assert/strict";
import test from "node:test";
import { generateArtifacts } from "../src/services/artifacts.js";

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
  assert.match(artifacts.find((artifact) => artifact.kind === "testing")?.content.sections[0]?.items[0] || "", /valid credentials/i);
});
