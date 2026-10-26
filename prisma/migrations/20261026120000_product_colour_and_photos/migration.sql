-- D95 / D98: per-product home colour and several photos per product (additive).

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "fieldColor" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_fieldColor_check" CHECK ("fieldColor" IS NULL OR "fieldColor" ~ '^#[0-9A-F]{6}$');

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: every existing cover becomes the first photo (Product.imageUrl stays as the denormalised cover).
INSERT INTO "ProductImage" ("id", "productId", "url", "sortOrder")
SELECT gen_random_uuid(), "id", "imageUrl", 0 FROM "Product" WHERE "imageUrl" IS NOT NULL;

-- Data: the existing products keep the colours they had on the home page (by name; absent names are skipped).
UPDATE "Product" SET "fieldColor" = '#DCC5BB' WHERE "name" = '奶酥红豆包';
UPDATE "Product" SET "fieldColor" = '#F0BF45' WHERE "name" = '岩烧乳酪包';
UPDATE "Product" SET "fieldColor" = '#CFDDEA' WHERE "name" = '奶酪角';
UPDATE "Product" SET "fieldColor" = '#B05219' WHERE "name" = '焦糖布蕾';
UPDATE "Product" SET "fieldColor" = '#5A3A2A' WHERE "name" = '巧克力奶酥吐司';
