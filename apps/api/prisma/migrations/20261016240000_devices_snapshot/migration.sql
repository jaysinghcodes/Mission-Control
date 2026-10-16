-- devices.snapshot. Existing sample rows stay source demo.
-- New bridge rows set source and kind in the snapshot handler.

ALTER TABLE "Device" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE "Device" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'device';
