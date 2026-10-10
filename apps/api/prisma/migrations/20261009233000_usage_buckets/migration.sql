-- Daily usage buckets replace one row per period.
--
-- A 24h / 7d / month total cannot be split back into days, so the old
-- UsageSnapshot rows are dropped. The bridge posts timestamped points.
-- GET /usage sums UsageBucket.at into the 24h, 7 day, and month windows.

-- CreateTable
CREATE TABLE "UsageBucket" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "providers" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageBucket_day_key" ON "UsageBucket"("day");

-- CreateIndex
CREATE INDEX "UsageBucket_at_idx" ON "UsageBucket"("at");

-- DropTable
DROP TABLE "UsageSnapshot";
