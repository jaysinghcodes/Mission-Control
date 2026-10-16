-- First run naming choice. Null until the operator picks crew or own names.
-- crewMap is agent id to a seat id from config/crew.json. It is not a name match.

ALTER TABLE "Setting" ADD COLUMN "namingMode" TEXT;
ALTER TABLE "Setting" ADD COLUMN "crewMap" JSONB;
