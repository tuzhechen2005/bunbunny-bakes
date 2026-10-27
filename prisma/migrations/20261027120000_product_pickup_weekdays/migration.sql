-- D115: pickup weekdays per product (additive). [] = every day, so existing products are unchanged.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "pickupWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Values 0–6 only, no NULL elements, never all seven (stored as []). Order and distinctness
-- are enforced by the app (src/server/products.ts).
ALTER TABLE "Product" ADD CONSTRAINT "Product_pickupWeekdays_check" CHECK (
  "pickupWeekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
  AND array_position("pickupWeekdays", NULL) IS NULL
  AND cardinality("pickupWeekdays") < 7
);
