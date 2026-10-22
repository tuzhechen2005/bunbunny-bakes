-- Per-day order counter (D30, D52): order numbers are never reused, even after an order
-- moves to another pickup date. allocateSeq (src/server/seq.ts) increments it while the
-- day's OpenDate row is locked.

ALTER TABLE "OpenDate" ADD COLUMN "lastSeq" INTEGER NOT NULL DEFAULT 0;

-- Backfill: the highest seq currently on each date.
UPDATE "OpenDate" d
SET "lastSeq" = s.max_seq
FROM (SELECT "pickupDate", MAX("seq") AS max_seq FROM "Order" GROUP BY "pickupDate") s
WHERE s."pickupDate" = d."date";

ALTER TABLE "OpenDate" ADD CONSTRAINT "OpenDate_lastSeq_chk" CHECK ("lastSeq" >= 0);
