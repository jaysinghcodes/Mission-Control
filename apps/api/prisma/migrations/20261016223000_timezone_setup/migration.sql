-- Timezone for usage and memory days. Null means the server timezone.
-- setupDone stays false until the first open is finished or skipped.

ALTER TABLE "Setting" ADD COLUMN "timezone" TEXT;
ALTER TABLE "Setting" ADD COLUMN "setupDone" BOOLEAN NOT NULL DEFAULT false;
