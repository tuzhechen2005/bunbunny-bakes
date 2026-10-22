-- Hand-written CHECK constraints (review #1 of m2a): fail closed on bad settings
-- and untrimmed WeChat ids.

-- Order.wechatId: 1-40 characters AND stored trimmed. btrim() only strips spaces,
-- so leading/trailing tabs/newlines are rejected with the regex as well.
ALTER TABLE "Order" DROP CONSTRAINT "Order_wechatId_chk";
ALTER TABLE "Order" ADD CONSTRAINT "Order_wechatId_chk" CHECK (
  char_length("wechatId") BETWEEN 1 AND 40
  AND "wechatId" = btrim("wechatId")
  AND "wechatId" !~ '^[[:space:]]|[[:space:]]$'
);

-- Setting: cutoffTime is a 24h HH:MM; fees/limits >= 0; at least 1 per item.
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_cutoffTime_chk"
  CHECK ("cutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_fees_chk"
  CHECK ("deliveryFeeCents" >= 0 AND "freeDeliveryMinCents" >= 0);
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_limits_chk"
  CHECK ("defaultDoughLimitG" >= 0 AND "defaultDeliveryLimit" >= 0);
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_maxQty_chk"
  CHECK ("maxQtyPerItem" >= 1);
