-- models.snapshot can mark a provider local. Usage prices those rows at $0.
ALTER TABLE "ModelConfig" ADD COLUMN "local" BOOLEAN NOT NULL DEFAULT false;
