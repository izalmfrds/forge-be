export type RequirementData = {
  prd: string;
  stories: string[];
  fr: string[];
  nfr: string[];
  ac: string[];
  rules: string[];
};

export function createRequirementDraft(project: { name: string; type: string; desc: string }, prompt = ""): RequirementData {
  const goal = project.desc || `deliver a clear ${project.type.toLowerCase()} experience`;
  const requested = prompt.trim();
  return {
    prd: `${project.name} is a ${project.type.toLowerCase()} whose goal is to ${goal}. The product should remain clear, consistent, accessible, and traceable from requirement to delivery.${requested ? ` Latest direction: ${requested}` : ""}`,
    stories: [
      `As a user, I want a clear ${project.type.toLowerCase()} so that I can complete my goal without friction.`,
      "As a product team, I want one source of truth so that design, frontend, backend, database, and testing stay aligned.",
      "As a reviewer, I want acceptance criteria attached to each story so that done is unambiguous.",
      "As an engineer, I want every generated artifact linked to its requirement so that impact is traceable.",
    ],
    fr: [
      "The system shall generate and version product requirements from AI Workspace conversations.",
      "The system shall persist projects, screens, canvas nodes, requirements, and Kanban tasks.",
      "The system shall snapshot the current requirement before sending it to Kanban.",
      "The system shall synchronize newly added requirement items without duplicating existing tasks.",
      "The system shall authorize project mutations by membership role.",
      ...(requested ? [`The system shall support this direction: ${requested}`] : []),
    ],
    nfr: [
      "Performance: API responses should complete within two seconds excluding external AI latency.",
      "Security: secrets and LLM provider keys must remain on the backend.",
      "Accessibility: generated user interfaces should meet WCAG AA contrast and keyboard requirements.",
    ],
    ac: [
      "Given an authenticated member, when they open a project, the latest requirement and screens are returned.",
      "Given an updated requirement, when it is sent to Kanban, a versioned snapshot is created.",
      "Given existing Kanban tasks, when synchronization runs, matching tasks are not duplicated.",
      "Given an unauthorized user, when they access a project, the API rejects the request.",
    ],
    rules: [
      "The requirement is the single source of truth.",
      "Only project owners and editors may mutate project artifacts.",
      "Only project owners may delete projects or manage members.",
      "LLM credentials are configured as backend environment variables.",
    ],
  };
}

export function mergeRequirement(current: RequirementData, prompt: string): RequirementData {
  const clean = prompt.trim();
  if (!clean) return current;
  const lower = clean.toLowerCase();
  if (lower.includes("story") || lower.includes("user")) {
    return { ...current, stories: [...current.stories, `As a stakeholder, I want ${clean} so that the latest need is captured.`] };
  }
  if (lower.includes("nfr") || lower.includes("non-functional")) {
    return { ...current, nfr: [...current.nfr, clean] };
  }
  if (lower.includes("accept") || /\bac\b/.test(lower)) {
    return { ...current, ac: [...current.ac, `Given the latest update, ${clean} is accepted.`] };
  }
  if (lower.includes("prd") || lower.includes("brief")) {
    return { ...current, prd: `${current.prd} ${clean}` };
  }
  if (lower.includes("functional") || /\bfr\b/.test(lower)) {
    return { ...current, fr: [...current.fr, `The system shall ${clean}.`] };
  }
  return { ...current, rules: [...current.rules, clean] };
}

export function requirementToCards(requirement: RequirementData) {
  const cards: { title: string; canvas: string | null; reqRef: string; requirementKey: string; status: string }[] = [];
  requirement.stories.forEach((text, index) => cards.push({ title: text.slice(0, 160), canvas: "design", reqRef: `Story ${index + 1}`, requirementKey: `story:${index + 1}`, status: "todo" }));
  requirement.fr.forEach((text, index) => cards.push({ title: text.slice(0, 160), canvas: inferCanvas(text), reqRef: `FR ${index + 1}`, requirementKey: `fr:${index + 1}`, status: "progress" }));
  requirement.nfr.forEach((text, index) => cards.push({ title: text.slice(0, 160), canvas: inferCanvas(text), reqRef: `NFR ${index + 1}`, requirementKey: `nfr:${index + 1}`, status: "done" }));
  requirement.ac.forEach((text, index) => cards.push({ title: text.slice(0, 160), canvas: inferCanvas(text), reqRef: `AC ${index + 1}`, requirementKey: `ac:${index + 1}`, status: "done" }));
  requirement.rules.forEach((text, index) => cards.push({ title: text.slice(0, 160), canvas: null, reqRef: `BR ${index + 1}`, requirementKey: `rule:${index + 1}`, status: "backlog" }));
  return cards;
}

function inferCanvas(text: string) {
  const value = text.toLowerCase();
  if (/design|screen|component|interface|accessib/.test(value)) return "design";
  if (/frontend|browser|page|route|form/.test(value)) return "frontend";
  if (/backend|api|server|auth/.test(value)) return "backend";
  if (/database|persist|schema|migration/.test(value)) return "database";
  if (/test|accept|quality|performance/.test(value)) return "testing";
  return null;
}
