import type { ArtifactContent, ArtifactKind, QualityReport } from "./artifacts.js";

const expectedEntry: Record<ArtifactKind, string> = {
  frontend: "src/app/page.tsx",
  backend: "src/routes/project.ts",
  database: "prisma/schema.prisma",
  testing: "tests/acceptance.spec.ts",
};

export function verifyArtifact(kind: ArtifactKind, content: ArtifactContent): QualityReport {
  const files = content.files || [];
  const paths = files.map((file) => file.path);
  const unsafePaths = paths.filter((path) => path.startsWith("/") || path.split("/").includes("..") || path.includes("\\"));
  const emptyFiles = files.filter((file) => !file.content.trim()).map((file) => file.path);
  const duplicatePaths = paths.filter((path, index) => paths.indexOf(path) !== index);
  const leakedFiles = files.filter((file) => containsSecret(file.content)).map((file) => file.path);
  const checks: QualityReport["checks"] = [
    check("files", "Generated files exist", files.length > 0, `${files.length} files generated`),
    check("entry", "Required entry file exists", paths.includes(expectedEntry[kind]), expectedEntry[kind]),
    check("paths", "File paths are safe", unsafePaths.length === 0, unsafePaths.length ? `Unsafe: ${unsafePaths.join(", ")}` : "No absolute or parent traversal paths"),
    check("unique", "File paths are unique", duplicatePaths.length === 0, duplicatePaths.length ? `Duplicate: ${[...new Set(duplicatePaths)].join(", ")}` : "No duplicate paths"),
    check("content", "Files contain content", emptyFiles.length === 0, emptyFiles.length ? `Empty: ${emptyFiles.join(", ")}` : "All files are non-empty"),
    check("secrets", "No secrets detected", leakedFiles.length === 0, leakedFiles.length ? `Potential secret: ${leakedFiles.join(", ")}` : "API keys and private keys are absent"),
    check("traceability", "Requirement sections are traceable", content.sections.length >= 3, `${content.sections.length} requirement sections linked`),
  ];
  return { status: checks.every((item) => item.passed) ? "passed" : "failed", checkedAt: new Date().toISOString(), checks };
}

function check(key: string, label: string, passed: boolean, detail: string) {
  return { key, label, passed, detail };
}

function containsSecret(content: string) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)
    || /\bAIza[0-9A-Za-z_-]{30,}\b/.test(content)
    || /\bAQ\.[0-9A-Za-z_-]{20,}\b/.test(content)
    || /(?:GEMINI_API_KEY|DATABASE_URL|API_KEY)[ \t]*=[ \t]*[^\s#][^\r\n]*/.test(content);
}
