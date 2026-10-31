ALTER TABLE "GameRun" ADD COLUMN "level" INTEGER,
  ADD COLUMN "passedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "GameRun_level_positive" CHECK ("level" IS NULL OR "level" > 0),
  ADD CONSTRAINT "GameRun_passed_level" CHECK ("passedAt" IS NULL OR ("level" IS NOT NULL AND "finishedAt" IS NOT NULL));
CREATE INDEX "GameRun_level_progress_idx" ON "GameRun" ("game", "weekKey", lower("wechatId"), "level" DESC) WHERE "passedAt" IS NOT NULL;
