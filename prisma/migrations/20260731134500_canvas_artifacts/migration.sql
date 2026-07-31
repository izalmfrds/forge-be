CREATE TABLE "CanvasArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requirementVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'synced',
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasArtifact_projectId_kind_key" ON "CanvasArtifact"("projectId", "kind");
CREATE INDEX "CanvasArtifact_projectId_idx" ON "CanvasArtifact"("projectId");

ALTER TABLE "CanvasArtifact"
ADD CONSTRAINT "CanvasArtifact_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
