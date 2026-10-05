-- Ticket 4 — Projects.
--
-- Adds a Project table and a nullable Ticket.projectId. One ticket belongs
-- to at most one project (the column is a single FK, not a join table).
-- Existing tickets stay valid: projectId defaults to NULL, so this migration
-- does not rewrite any ticket row beyond adding the column.
--
-- Archive is NOT a delete. ProjectsController sets "archivedAt"; nothing in
-- the app deletes a Project row. ON DELETE SET NULL is here so a manual
-- DELETE of a project still cannot cascade-delete its tickets — they become
-- unassigned instead.
--
-- nameKey uniqueness is case-insensitive equality ("Roadmap" vs "roadmap").
-- The API stores lower(trim(name)) in nameKey and rejects a blank name with
-- 400 before insert. A CHECK constraint is intentionally absent: Postgres
-- would raise that as an error the API layer turns into 500, and this
-- codebase answers validation failures with a 4xx and a message.

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_nameKey_key" ON "Project"("nameKey");

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_projectId_idx" ON "Ticket"("projectId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
