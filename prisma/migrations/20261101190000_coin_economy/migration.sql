CREATE TYPE "CoinReason" AS ENUM ('GAME_RUN', 'ORDER', 'PURCHASE', 'ITEM_USE_REFUND', 'ADMIN');
CREATE TABLE "CoinLedger" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "wechatIdNorm" TEXT NOT NULL CHECK ("wechatIdNorm" <> '' AND "wechatIdNorm" = lower(btrim("wechatIdNorm"))),
  "delta" INTEGER NOT NULL,
  "reason" "CoinReason" NOT NULL,
  "refId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CoinLedger_reason_refId_key" ON "CoinLedger" ("reason", "refId");
CREATE INDEX "CoinLedger_wechatIdNorm_createdAt_idx" ON "CoinLedger" ("wechatIdNorm", "createdAt");
CREATE TABLE "Inventory" (
  "wechatIdNorm" TEXT NOT NULL CHECK ("wechatIdNorm" <> '' AND "wechatIdNorm" = lower(btrim("wechatIdNorm"))),
  "item" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0 CHECK ("count" >= 0),
  PRIMARY KEY ("wechatIdNorm", "item")
);
CREATE FUNCTION coin_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CoinLedger is append-only'; END;
$$;
CREATE TRIGGER coin_ledger_immutable BEFORE UPDATE OR DELETE ON "CoinLedger"
FOR EACH ROW EXECUTE FUNCTION coin_ledger_immutable();
