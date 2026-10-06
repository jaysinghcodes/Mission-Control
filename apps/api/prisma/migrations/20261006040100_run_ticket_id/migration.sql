-- QA-13 — Pipeline matches a run to a ticket by id.
--
-- Nullable on purpose. Existing runs stay valid (ticketId NULL). When no
-- run points at a ticket, the pipeline falls back to the ticket's createdAt.
-- ON DELETE SET NULL: removing a ticket must not delete the run.

-- AlterTable
ALTER TABLE "Run" ADD COLUMN "ticketId" TEXT;

-- CreateIndex
CREATE INDEX "Run_ticketId_idx" ON "Run"("ticketId");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
