-- Ticket 7 — Team mission and devices.
--
-- Setting is one row (the API uses id = 'default') holding the mission
-- statement. An empty string is valid: the Team page shows a placeholder.
-- Device is the machines list. seed:demo inserts three sample rows.
-- The bridge has no devices channel, so nothing else writes this table.
--
-- updatedAt has no SQL default on purpose, matching Project and
-- MemoryEntry. Prisma writes it. A CHECK on mission length is
-- intentionally absent: a check failure would surface as 500, and this
-- API answers a too-long mission with 400.

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "mission" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
