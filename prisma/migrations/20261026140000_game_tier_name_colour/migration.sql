-- Game-only pieces (D107): a non-big GameTier with no product carries its own name and colour.
-- Product tiers may override the colour (and name) too; NULL means "use the product's".
ALTER TABLE "GameTier" ADD COLUMN "name" TEXT;
ALTER TABLE "GameTier" ADD COLUMN "fieldColor" TEXT;
ALTER TABLE "GameTier" ADD CONSTRAINT "GameTier_name_check" CHECK ("name" IS NULL OR char_length("name") BETWEEN 1 AND 12);
ALTER TABLE "GameTier" ADD CONSTRAINT "GameTier_fieldColor_check" CHECK ("fieldColor" IS NULL OR "fieldColor" ~ '^#[0-9A-F]{6}$');
