-- CreateEnum
CREATE TYPE "SaleMode" AS ENUM ('NORMAL', 'GROUP');

-- CreateEnum
CREATE TYPE "GroupDecision" AS ENUM ('OPEN', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "IfNotFormed" AS ENUM ('CONTACT', 'CANCEL');

-- DropIndex
DROP INDEX "OrderItem_orderId_productId_flavorId_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "groupMin" INTEGER,
ADD COLUMN     "saleMode" "SaleMode" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "ProductFlavor" ADD COLUMN     "pickupWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "ifNotFormed" "IfNotFormed",
ADD COLUMN     "stockLotId" UUID;

-- CreateTable
CREATE TABLE "GroupPool" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "productId" UUID NOT NULL,
    "flavorId" UUID,
    "decision" "GroupDecision" NOT NULL DEFAULT 'OPEN',
    "minOverride" INTEGER,
    "decidedAt" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "GroupPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "productId" UUID NOT NULL,
    "flavorId" UUID,
    "qty" INTEGER NOT NULL,
    "madeAt" TIMESTAMPTZ(3),
    "sellUntil" TIMESTAMPTZ(3) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupPoolId" UUID,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupPool_date_productId_flavorId_key" ON "GroupPool"("date", "productId", "flavorId");

-- CreateIndex
CREATE INDEX "StockLot_date_idx" ON "StockLot"("date");

-- CreateIndex
CREATE INDEX "OrderItem_stockLotId_idx" ON "OrderItem"("stockLotId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_stockLotId_fkey" FOREIGN KEY ("stockLotId") REFERENCES "StockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPool" ADD CONSTRAINT "GroupPool_date_fkey" FOREIGN KEY ("date") REFERENCES "OpenDate"("date") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPool" ADD CONSTRAINT "GroupPool_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPool" ADD CONSTRAINT "GroupPool_flavorId_productId_fkey" FOREIGN KEY ("flavorId", "productId") REFERENCES "ProductFlavor"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_groupPoolId_fkey" FOREIGN KEY ("groupPoolId") REFERENCES "GroupPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_date_fkey" FOREIGN KEY ("date") REFERENCES "OpenDate"("date") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_flavorId_productId_fkey" FOREIGN KEY ("flavorId", "productId") REFERENCES "ProductFlavor"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "OrderItem_orderId_productId_null_flavor_key";
CREATE UNIQUE INDEX "OrderItem_line_identity" ON "OrderItem" ("orderId", "productId", COALESCE("flavorId"::text, ''), COALESCE("stockLotId"::text, ''));
CREATE UNIQUE INDEX "GroupPool_null_flavor" ON "GroupPool" ("date", "productId") WHERE "flavorId" IS NULL;
CREATE UNIQUE INDEX "StockLot_open_pool" ON "StockLot" ("groupPoolId") WHERE NOT "closed" AND "groupPoolId" IS NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_group_valid" CHECK ("saleMode" <> 'GROUP' OR ("capacityMode" = 'INDEPENDENT' AND "batchYield" IS NOT NULL AND "groupMin" IS NOT NULL AND "groupMin" BETWEEN 1 AND "batchYield"));
ALTER TABLE "GroupPool" ADD CONSTRAINT "GroupPool_min_valid" CHECK ("minOverride" IS NULL OR "minOverride" > 0);
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_qty_valid" CHECK ("qty" >= 0);
ALTER TABLE "ProductFlavor" ADD CONSTRAINT "ProductFlavor_weekdays_valid" CHECK ("pickupWeekdays" <@ ARRAY[0,1,2,3,4,5,6]);
