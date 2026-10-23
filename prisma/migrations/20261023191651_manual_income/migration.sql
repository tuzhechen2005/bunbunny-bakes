-- CreateTable
CREATE TABLE "ManualIncome" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "paidMethod" "PaidMethod" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualIncomeItem" (
    "id" UUID NOT NULL,
    "incomeId" UUID NOT NULL,
    "productId" UUID,
    "nameSnapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ManualIncomeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualIncome_date_idx" ON "ManualIncome"("date");

-- CreateIndex
CREATE INDEX "ManualIncomeItem_incomeId_idx" ON "ManualIncomeItem"("incomeId");

-- CreateIndex
CREATE INDEX "ManualIncomeItem_productId_idx" ON "ManualIncomeItem"("productId");

-- AddForeignKey
ALTER TABLE "ManualIncomeItem" ADD CONSTRAINT "ManualIncomeItem_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "ManualIncome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncomeItem" ADD CONSTRAINT "ManualIncomeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
