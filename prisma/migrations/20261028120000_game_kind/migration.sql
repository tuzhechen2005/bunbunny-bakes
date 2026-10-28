-- 兔了个兔 (D121, D124): a game discriminator on runs and awards. Additive: every existing row
-- is the first game (BIG). Bans stay one shared list.

-- CreateEnum
CREATE TYPE "GameKind" AS ENUM ('BIG', 'TU');

-- AlterTable
ALTER TABLE "GameRun" ADD COLUMN "game" "GameKind" NOT NULL DEFAULT 'BIG',
ADD COLUMN "playMs" INTEGER,
ADD COLUMN "suspicious" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GameAward" ADD COLUMN "game" "GameKind" NOT NULL DEFAULT 'BIG';

-- One award per game and week (was: per week).
DROP INDEX "GameAward_weekKey_key";
CREATE UNIQUE INDEX "GameAward_game_weekKey_key" ON "GameAward"("game", "weekKey");

-- Board queries filter by game first.
DROP INDEX "GameRun_weekKey_score_idx";
CREATE INDEX "GameRun_game_weekKey_score_idx" ON "GameRun"("game", "weekKey", "score" DESC);
