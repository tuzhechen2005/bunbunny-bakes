-- CreateTable
CREATE TABLE "GameTier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "isBig" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seed" TEXT NOT NULL,
    "wechatId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "tiersSnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "score" INTEGER,
    "drops" JSONB,
    "dropCount" INTEGER,
    "simSteps" INTEGER,
    "weekKey" TEXT,
    "ipHash" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GameRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameBan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wechatId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAward" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "weekKey" TEXT NOT NULL,
    "runId" UUID NOT NULL,
    "contactedAt" TIMESTAMPTZ(3),
    "redeemedAt" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "GameAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameTier_sortOrder_idx" ON "GameTier"("sortOrder");

-- CreateIndex
CREATE INDEX "GameTier_productId_idx" ON "GameTier"("productId");

-- CreateIndex
CREATE INDEX "GameRun_weekKey_score_idx" ON "GameRun"("weekKey", "score" DESC);

-- CreateIndex
CREATE INDEX "GameRun_wechatId_idx" ON "GameRun"("wechatId");

-- CreateIndex
CREATE INDEX "GameRun_startedAt_idx" ON "GameRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameAward_weekKey_key" ON "GameAward"("weekKey");

-- CreateIndex
CREATE INDEX "GameAward_runId_idx" ON "GameAward"("runId");

-- AddForeignKey
ALTER TABLE "GameTier" ADD CONSTRAINT "GameTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAward" ADD CONSTRAINT "GameAward_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GameRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Case-insensitive uniqueness of banned WeChat ids (D92 compares ids without regard to case).
CREATE UNIQUE INDEX "GameBan_wechatId_lower_key" ON "GameBan"(lower("wechatId"));

-- Best-per-player lookups compare lower("wechatId").
CREATE INDEX "GameRun_wechatId_lower_idx" ON "GameRun"(lower("wechatId"));
