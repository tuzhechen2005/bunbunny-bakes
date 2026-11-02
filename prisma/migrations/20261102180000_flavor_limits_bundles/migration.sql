ALTER TABLE "ProductFlavor" ADD COLUMN "dailyLimit" INTEGER, ADD COLUMN "bundlePriceCents" INTEGER;
ALTER TABLE "ProductFlavor" ADD CONSTRAINT "ProductFlavor_dailyLimit_check" CHECK ("dailyLimit" >= 0), ADD CONSTRAINT "ProductFlavor_bundlePriceCents_check" CHECK ("bundlePriceCents" > 0);
CREATE TABLE "OpenDateFlavorLimit" (
  "date" DATE NOT NULL,
  "flavorId" UUID NOT NULL,
  "limit" INTEGER NOT NULL CHECK ("limit" >= 0),
  CONSTRAINT "OpenDateFlavorLimit_pkey" PRIMARY KEY ("date", "flavorId"),
  CONSTRAINT "OpenDateFlavorLimit_date_fkey" FOREIGN KEY ("date") REFERENCES "OpenDate"("date") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpenDateFlavorLimit_flavorId_fkey" FOREIGN KEY ("flavorId") REFERENCES "ProductFlavor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
