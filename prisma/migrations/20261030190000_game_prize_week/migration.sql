-- CreateEnum
CREATE TYPE "GamePrizeChosenBy" AS ENUM ('RANDOM', 'OWNER');

-- CreateTable
CREATE TABLE "GamePrizeWeek" (
    "weekKey" TEXT NOT NULL,
    "game" "GameKind" NOT NULL,
    "chosenBy" "GamePrizeChosenBy" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePrizeWeek_pkey" PRIMARY KEY ("weekKey")
);

