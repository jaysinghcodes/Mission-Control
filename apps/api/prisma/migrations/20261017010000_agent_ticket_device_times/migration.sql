-- Ticket notes, and device pairing time separate from last seen.

ALTER TABLE "Ticket" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Device" ADD COLUMN "pairedAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "requestedAt" TIMESTAMP(3);
