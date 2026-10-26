// TEMPORARY (L3): the game tables of the l-tasks.md contract, created with IF NOT EXISTS in the
// test database only. L1's migration owns the real tables; delete this file (and its two
// callers) after L1 merges and recreate the test DB so `prisma migrate deploy` makes them.

export const GAME_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "GameTier" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "productId" uuid REFERENCES "Product"("id") ON DELETE SET NULL,
     "sortOrder" int NOT NULL DEFAULT 0,
     "imageUrl" text NOT NULL DEFAULT '',
     "isBig" boolean NOT NULL DEFAULT false,
     "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
     "updatedAt" timestamptz(3) NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS "GameRun" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "seed" text NOT NULL DEFAULT 'seed',
     "wechatId" text NOT NULL,
     "nickname" text NOT NULL,
     "tiersSnapshot" jsonb NOT NULL DEFAULT '[]',
     "startedAt" timestamptz(3) NOT NULL DEFAULT now(),
     "finishedAt" timestamptz(3),
     "score" int,
     "weekKey" text,
     "ipHash" text,
     "hidden" boolean NOT NULL DEFAULT false)`,
  `CREATE TABLE IF NOT EXISTS "GameBan" (
     "wechatId" text NOT NULL,
     "reason" text,
     "createdAt" timestamptz(3) NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "GameBan_lower_wechatId" ON "GameBan" (lower("wechatId"))`,
  `CREATE TABLE IF NOT EXISTS "GameAward" (
     "weekKey" text PRIMARY KEY,
     "runId" uuid NOT NULL,
     "contactedAt" timestamptz(3),
     "redeemedAt" timestamptz(3),
     "note" text)`,
];
