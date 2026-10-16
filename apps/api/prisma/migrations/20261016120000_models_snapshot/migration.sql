-- models.snapshot stores the provider and model for each agent.
-- openclawVersion rides on the existing settings row.
ALTER TABLE "ModelConfig" ADD COLUMN "agentId" TEXT;
ALTER TABLE "ModelConfig" ADD COLUMN "agentName" TEXT;

ALTER TABLE "Setting" ADD COLUMN "openclawVersion" TEXT;
