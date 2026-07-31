CREATE TABLE "OrchestrationRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requirementVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'automatic',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrchestrationRun_projectId_createdAt_idx" ON "OrchestrationRun"("projectId", "createdAt");
CREATE INDEX "OrchestrationRun_projectId_requirementVersion_idx" ON "OrchestrationRun"("projectId", "requirementVersion");

ALTER TABLE "OrchestrationRun"
ADD CONSTRAINT "OrchestrationRun_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
