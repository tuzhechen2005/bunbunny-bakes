CREATE TABLE "ProductFlavor" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFlavor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductFlavor_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 12),
  CONSTRAINT "ProductFlavor_priceCents_check" CHECK ("priceCents" BETWEEN 0 AND 1000000),
  CONSTRAINT "ProductFlavor_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductFlavor_id_productId_key" ON "ProductFlavor"("id", "productId");
CREATE INDEX "ProductFlavor_productId_sort_idx" ON "ProductFlavor"("productId", "sort");
ALTER TABLE "OrderItem" ADD COLUMN "flavorId" UUID, ADD COLUMN "flavorName" TEXT;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_flavorId_productId_fkey"
  FOREIGN KEY ("flavorId", "productId") REFERENCES "ProductFlavor"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OrderItem_orderId_productId_flavorId_key" ON "OrderItem"("orderId", "productId", "flavorId");
-- NULL is a real legacy/unflavoured line identity, too.
CREATE UNIQUE INDEX "OrderItem_orderId_productId_null_flavor_key" ON "OrderItem"("orderId", "productId") WHERE "flavorId" IS NULL;
