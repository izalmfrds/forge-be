import test from "node:test";
import assert from "node:assert/strict";
import { createRequirementDraft, mergeRequirement, requirementToCards } from "../src/services/requirements.js";

test("requirement generation returns all required sections", () => {
  const requirement = createRequirementDraft({
    name: "Atlas",
    type: "Brand system",
    desc: "ship a consistent brand",
  });
  assert.match(requirement.prd, /Atlas/);
  assert.ok(requirement.stories.length >= 4);
  assert.ok(requirement.fr.length >= 5);
  assert.ok(requirement.nfr.length >= 3);
  assert.ok(requirement.ac.length >= 4);
  assert.ok(requirement.rules.length >= 4);
});

test("a new prompt creates a new requirement item without mutating the previous value", () => {
  const original = createRequirementDraft({ name: "Atlas", type: "Brand system", desc: "" });
  const updated = mergeRequirement(original, "Add a user story for SSO");
  assert.equal(original.stories.length + 1, updated.stories.length);
  assert.notEqual(original, updated);
});

test("Kanban extraction is deterministic", () => {
  const requirement = createRequirementDraft({ name: "Atlas", type: "Brand system", desc: "" });
  const first = requirementToCards(requirement);
  const second = requirementToCards(requirement);
  assert.deepEqual(first, second);
  assert.ok(first.some((card) => card.status === "todo"));
  assert.ok(first.some((card) => card.reqRef === "FR 1"));
  assert.equal(new Set(first.map((card) => card.requirementKey)).size, first.length);
});
