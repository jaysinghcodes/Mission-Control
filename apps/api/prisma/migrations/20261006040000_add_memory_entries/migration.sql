-- Ticket 5 — Memory entries.
--
-- One row per remembered note. The bridge upserts by a stable id (agent +
-- workspace path) so a re-sync updates the same row instead of inserting
-- another. seed:demo uses fixed demo-memory-* ids the same way.
--
-- The web app reads this table. It does not open OpenClaw files on disk.
-- kind is long-term | daily | other. Calendar days are not stored: the API
-- derives America/Chicago days from createdAt.
--
-- updatedAt has no SQL default on purpose, matching Project. Prisma writes
-- it. A CHECK on kind is intentionally absent: a check failure would surface
-- as 500, and this API answers bad input with 4xx.

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT,
    "ref" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryEntry_createdAt_idx" ON "MemoryEntry"("createdAt");

-- CreateIndex
CREATE INDEX "MemoryEntry_kind_idx" ON "MemoryEntry"("kind");
