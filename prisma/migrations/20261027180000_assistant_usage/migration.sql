-- D118: 小小🐰 per-day message counts (per IP hash, plus the global row ipHash = '*').

-- CreateTable
CREATE TABLE "AssistantUsage" (
    "day" DATE NOT NULL,
    "ipHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssistantUsage_pkey" PRIMARY KEY ("day","ipHash")
);
