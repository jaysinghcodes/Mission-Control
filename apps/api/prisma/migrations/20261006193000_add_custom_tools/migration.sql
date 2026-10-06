-- Ticket 10 — Custom tools (experimental).
--
-- One row is a saved prompt template and the named inputs it fills.
-- The API substitutes {{name}} placeholders for a preview / test run and
-- does not call OpenClaw or any other service from that path.
--
-- name is UNIQUE after the API trims it. Blank names, empty templates, and
-- a placeholder with no matching input are rejected in the controller with
-- 400. A duplicate name is 409. There is no CHECK constraint: Postgres
-- would surface that as an error the API turns into 500, and this codebase
-- answers validation failures with a 4xx and a message.

-- CreateTable
CREATE TABLE "CustomTool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "promptTemplate" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomTool_name_key" ON "CustomTool"("name");
