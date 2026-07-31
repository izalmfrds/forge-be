import type { RequirementData } from "./requirements.js";

export const artifactKinds = ["frontend", "backend", "database", "testing"] as const;
export type ArtifactKind = typeof artifactKinds[number];

type ArtifactTask = { id: string; title: string; canvas: string | null; status: string; reqRef: string | null };

export type ArtifactContent = {
  summary: string;
  sections: { title: string; items: string[] }[];
  tasks: { id: string; title: string; status: string; reqRef: string | null }[];
  files: ArtifactFile[];
  quality?: QualityReport;
};

export type ArtifactFile = { path: string; language: string; content: string };
export type QualityReport = {
  status: "passed" | "failed";
  checkedAt: string;
  checks: { key: string; label: string; passed: boolean; detail: string }[];
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
  const byKind: Record<ArtifactKind, Omit<ArtifactContent, "tasks" | "files">> = {
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
  return { ...byKind[kind], tasks: commonTasks, files: generateFiles(kind, project, requirement) };
}

function generateFiles(kind: ArtifactKind, project: { name: string; desc: string }, requirement: RequirementData): ArtifactFile[] {
  const projectName = JSON.stringify(project.name);
  const acceptance = JSON.stringify(requirement.ac.slice(0, 12), null, 2);
  const files: Record<ArtifactKind, ArtifactFile[]> = {
    frontend: [
      {
        path: "src/app/page.tsx",
        language: "tsx",
        content: `export default function HomePage() {\n  return (\n    <main className="min-h-screen bg-zinc-50 p-8">\n      <h1 className="text-2xl font-semibold">{${projectName}}</h1>\n      <p className="mt-2 text-zinc-600">${escapeTemplate(project.desc || requirement.prd.slice(0, 180))}</p>\n    </main>\n  );\n}\n`,
      },
      {
        path: "src/components/RequirementStatus.tsx",
        language: "tsx",
        content: `export function RequirementStatus({ version }: { version: number }) {\n  return <span aria-label={\`Requirement version \${version}\`}>Requirement v{version} synced</span>;\n}\n`,
      },
      { path: "README.md", language: "markdown", content: markdownSummary(project.name, "Frontend", requirement) },
    ],
    backend: [
      {
        path: "src/routes/project.ts",
        language: "typescript",
        content: `import { Router } from "express";\n\nconst router = Router();\n\nrouter.get("/:id", async (req, res) => {\n  res.json({ id: req.params.id, project: ${projectName} });\n});\n\nexport default router;\n`,
      },
      {
        path: "src/services/project-service.ts",
        language: "typescript",
        content: `export const businessRules = ${JSON.stringify(requirement.rules.slice(0, 12), null, 2)} as const;\n\nexport function assertProjectAccess(isMember: boolean) {\n  if (!isMember) throw new Error("Project access denied");\n}\n`,
      },
      { path: ".env.example", language: "dotenv", content: "DATABASE_URL=\nGEMINI_API_KEY=\nFRONTEND_URL=http://localhost:3000\n" },
    ],
    database: [
      {
        path: "prisma/schema.prisma",
        language: "prisma",
        content: `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel Project {\n  id          String        @id @default(cuid())\n  name        String\n  description String        @default("")\n  requirements Requirement[]\n  createdAt   DateTime      @default(now())\n  updatedAt   DateTime      @updatedAt\n}\n\nmodel Requirement {\n  id        String   @id @default(cuid())\n  projectId String\n  version   Int\n  data      Json\n  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)\n  createdAt DateTime @default(now())\n\n  @@unique([projectId, version])\n}\n`,
      },
      { path: "prisma/migrations/README.md", language: "markdown", content: "# Migration policy\n\n- Prefer additive migrations.\n- Add indexes for project and version lookups.\n- Validate rollback and cascade behavior before deployment.\n" },
    ],
    testing: [
      {
        path: "tests/acceptance.spec.ts",
        language: "typescript",
        content: `import { test, expect } from "@playwright/test";\n\nconst acceptanceCriteria = ${acceptance} as const;\n\ntest("project meets its acceptance criteria", async ({ page }) => {\n  await page.goto("/");\n  await expect(page.locator("body")).toBeVisible();\n  expect(acceptanceCriteria.length).toBeGreaterThan(0);\n});\n`,
      },
      { path: "tests/README.md", language: "markdown", content: markdownSummary(project.name, "Testing", requirement) },
    ],
  };
  return files[kind];
}

function markdownSummary(projectName: string, area: string, requirement: RequirementData) {
  return `# ${projectName} — ${area}\n\nGenerated from the current Forge Requirement.\n\n## Acceptance criteria\n\n${requirement.ac.map((item) => `- ${item}`).join("\n")}\n`;
}

function escapeTemplate(value: string) {
  return value.replace(/[`\\$]/g, (character) => `\\${character}`).replace(/\r?\n/g, " ");
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
