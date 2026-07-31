ALTER TABLE "KanbanCard"
ADD COLUMN "requirementKey" TEXT,
ADD COLUMN "requirementVersion" INTEGER,
ADD COLUMN "obsolete" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "KanbanCard_projectId_requirementKey_key"
ON "KanbanCard"("projectId", "requirementKey");
