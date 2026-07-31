import type { RequirementData } from "./requirements.js";

export const artifactKinds = ["frontend", "backend", "database", "testing"] as const;
export type ArtifactKind = typeof artifactKinds[number];

type ArtifactTask = { id: string; title: string; canvas: string | null; status: string; reqRef: string | null };

export type ArtifactContent = {
  summary: string;
  sections: { title: string; items: string[] }[];
  tasks: { id: string; title: string; status: string; reqRef: string | null }[];
};

export function generateArtifacts(project: { name: string; desc: string }, requirement: RequirementData, cards: ArtifactTask[]) {
  const taskMap = new Map(artifactKinds.map((kind) => [kind, cards.filter((card) => card.canvas === kind && !card.title.toLowerCase().includes("obsolete"))]));
  return artifactKinds.map((kind) => ({
    kind,
    content: generateArtifact(kind, project, requirement, taskMap.get(kind) || []),
  }));
}

function generateArtifact(kind: ArtifactKind, project: { name: string; desc: string }, requirement: RequirementData, tasks: ArtifactTask[]): ArtifactContent {
  const commonTasks = tasks.map(({ id, title, status, reqRef }) => ({ id, title, status, reqRef }));
  const byKind: Record<ArtifactKind, Omit<ArtifactContent, "tasks">> = {
    frontend: {
      summary: `Frontend delivery blueprint for ${project.name}, derived from requirement and Kanban.`,
      sections: [
        { title: "Pages & flows", items: unique([...requirement.stories.slice(0, 6), ...requirement.fr.filter((item) => /page|screen|form|frontend|browser|route/i.test(item))]) },
        { title: "Components", items: deriveComponents(requirement) },
        { title: "Quality constraints", items: requirement.nfr.filter((item) => /access|performance|browser|interface/i.test(item)) },
      ],
    },
    backend: {
      summary: `Backend API and service blueprint for ${project.name}.`,
      sections: [
        { title: "API capabilities", items: requirement.fr.filter((item) => /api|server|auth|generate|persist|sync|project/i.test(item)) },
        { title: "Business rules", items: requirement.rules.slice(0, 12) },
        { title: "Security", items: requirement.nfr.filter((item) => /security|secret|auth|privacy/i.test(item)) },
      ],
    },
    database: {
      summary: `Data model and persistence blueprint for ${project.name}.`,
      sections: [
        { title: "Core entities", items: deriveEntities(requirement) },
        { title: "Persistence rules", items: unique([...requirement.fr.filter((item) => /persist|store|version|snapshot|database|history/i.test(item)), ...requirement.rules.filter((item) => /source of truth|delete|owner/i.test(item))]) },
        { title: "Migration checks", items: ["Use additive, reversible migrations.", "Keep project-owned records cascade-safe.", "Index project, status, and version lookup fields."] },
      ],
    },
    testing: {
      summary: `Verification plan for ${project.name}.`,
      sections: [
        { title: "Acceptance scenarios", items: requirement.ac.slice(0, 20) },
        { title: "Non-functional checks", items: requirement.nfr.slice(0, 12) },
        { title: "Release gates", items: ["All acceptance criteria pass.", "No critical accessibility violations.", "API authorization and error paths are covered.", "Generated artifacts match the latest requirement version."] },
      ],
    },
  };
  return { ...byKind[kind], tasks: commonTasks };
}

function deriveComponents(requirement: RequirementData) {
  const text = [...requirement.stories, ...requirement.fr].join(" ").toLowerCase();
  const candidates = ["Application shell", "Navigation", "Form", "Button", "Input", "Status badge", "Loading state", "Error state"];
  return candidates.filter((item) => item === "Application shell" || text.includes(item.toLowerCase().split(" ")[0]));
}

function deriveEntities(requirement: RequirementData) {
  const text = [requirement.prd, ...requirement.fr, ...requirement.rules].join(" ").toLowerCase();
  const entities = ["User", "Project", "Requirement", "RequirementVersion", "KanbanTask", "Screen", "CanvasArtifact", "ChatMessage"];
  return entities.filter((entity) => ["User", "Project", "Requirement"].includes(entity) || text.includes(entity.replace(/[A-Z]/g, (letter) => ` ${letter}`).trim().toLowerCase().split(" ").at(-1)!));
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}
