-- CreateEnum
CREATE TYPE "CapacityMode" AS ENUM ('DOUGH_PER_UNIT', 'DOUGH_PER_ROUND', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONTACTED', 'CONFIRMED', 'BAKING', 'READY', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Fulfillment" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('WEB', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaidMethod" AS ENUM ('WECHAT', 'ZELLE', 'VENMO', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('ADMIN', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('NEW_ORDER', 'CUSTOMER_CANCELLED', 'DAILY_SUMMARY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "orderingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cutoffTime" TEXT NOT NULL DEFAULT '20:00',
    "defaultDoughLimitG" INTEGER NOT NULL DEFAULT 1600,
    "defaultDeliveryLimit" INTEGER NOT NULL DEFAULT 8,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 500,
    "freeDeliveryMinCents" INTEGER NOT NULL DEFAULT 2500,
    "maxQtyPerItem" INTEGER NOT NULL DEFAULT 8,
    "ownerWechatId" TEXT NOT NULL DEFAULT '',
    "showWechatOnHome" BOOLEAN NOT NULL DEFAULT false,
    "pickupNote" TEXT NOT NULL DEFAULT '自提时间在下午 5 点以后，具体时间微信确认',
    "bakingTextBread" TEXT NOT NULL DEFAULT '正在为你制作大面包！',
    "bakingTextOther" TEXT NOT NULL DEFAULT '正在为你制作布蕾！',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "unitPriceCents" INTEGER NOT NULL,
    "bundleSize" INTEGER NOT NULL DEFAULT 4,
    "bundlePriceCents" INTEGER,
    "capacityMode" "CapacityMode" NOT NULL,
    "doughG" INTEGER,
    "roundG" INTEGER,
    "piecesPerRound" INTEGER,
    "dailyLimit" INTEGER,
    "batchYield" INTEGER,
    "leadDays" INTEGER NOT NULL DEFAULT 1,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenDate" (
    "date" DATE NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "doughLimitG" INTEGER,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryLimit" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenDate_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "OpenDateProductLimit" (
    "date" DATE NOT NULL,
    "productId" UUID NOT NULL,
    "limit" INTEGER NOT NULL,

    CONSTRAINT "OpenDateProductLimit_pkey" PRIMARY KEY ("date","productId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "pickupDate" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "orderNo" TEXT NOT NULL,
    "viewToken" TEXT NOT NULL,
    "wechatId" TEXT NOT NULL,
    "fulfillment" "Fulfillment" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "note" TEXT,
    "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "source" "OrderSource" NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidMethod" "PaidMethod",
    "paidAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" "CancelledBy",

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "bundleSize" INTEGER NOT NULL,
    "bundlePriceCents" INTEGER,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "actor" "Actor" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_viewToken_key" ON "Order"("viewToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_pickupDate_status_idx" ON "Order"("pickupDate", "status");

-- CreateIndex
CREATE INDEX "Order_wechatId_pickupDate_idx" ON "Order"("wechatId", "pickupDate");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_pickupDate_seq_key" ON "Order"("pickupDate", "seq");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "RateLimitHit_key_at_idx" ON "RateLimitHit"("key", "at");

-- AddForeignKey
ALTER TABLE "OpenDateProductLimit" ADD CONSTRAINT "OpenDateProductLimit_date_fkey" FOREIGN KEY ("date") REFERENCES "OpenDate"("date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenDateProductLimit" ADD CONSTRAINT "OpenDateProductLimit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupDate_fkey" FOREIGN KEY ("pickupDate") REFERENCES "OpenDate"("date") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (hand-written; Prisma cannot express them).
-- The app validates with Zod first; these are the last line of defence.
-- ---------------------------------------------------------------------------

-- Setting is a single row.
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_single_row_chk" CHECK ("id" = 1);

-- Product: capacity mode <-> required fields.
ALTER TABLE "Product" ADD CONSTRAINT "Product_capacity_mode_chk" CHECK (
  ("capacityMode" = 'DOUGH_PER_UNIT' AND "doughG" IS NOT NULL AND "doughG" > 0)
  OR ("capacityMode" = 'DOUGH_PER_ROUND' AND "roundG" IS NOT NULL AND "roundG" > 0
      AND "piecesPerRound" IS NOT NULL AND "piecesPerRound" >= 1)
  OR ("capacityMode" = 'INDEPENDENT' AND "dailyLimit" IS NOT NULL AND "dailyLimit" >= 0)
);

-- Product: prices and other numbers.
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitPrice_chk" CHECK ("unitPriceCents" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_bundleSize_chk" CHECK ("bundleSize" >= 1);
ALTER TABLE "Product" ADD CONSTRAINT "Product_bundlePrice_chk" CHECK ("bundlePriceCents" IS NULL OR "bundlePriceCents" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_leadDays_chk" CHECK ("leadDays" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_batchYield_chk" CHECK ("batchYield" IS NULL OR "batchYield" >= 1);

-- OpenDate: overrides are null (use the default) or >= 0.
ALTER TABLE "OpenDate" ADD CONSTRAINT "OpenDate_doughLimit_chk" CHECK ("doughLimitG" IS NULL OR "doughLimitG" >= 0);
ALTER TABLE "OpenDate" ADD CONSTRAINT "OpenDate_deliveryLimit_chk" CHECK ("deliveryLimit" IS NULL OR "deliveryLimit" >= 0);

-- OpenDateProductLimit.
ALTER TABLE "OpenDateProductLimit" ADD CONSTRAINT "OpenDateProductLimit_limit_chk" CHECK ("limit" >= 0);

-- Order.
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_chk" CHECK (
  "subtotalCents" >= 0 AND "deliveryFeeCents" >= 0 AND "totalCents" >= 0
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_wechatId_chk" CHECK (char_length("wechatId") BETWEEN 1 AND 40);
ALTER TABLE "Order" ADD CONSTRAINT "Order_note_chk" CHECK ("note" IS NULL OR char_length("note") <= 300);
ALTER TABLE "Order" ADD CONSTRAINT "Order_seq_chk" CHECK ("seq" >= 1);

-- OrderItem.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_chk" CHECK ("qty" >= 1);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_snapshot_chk" CHECK (
  "unitPriceCents" >= 0 AND "bundleSize" >= 1
  AND ("bundlePriceCents" IS NULL OR "bundlePriceCents" >= 0)
  AND "lineTotalCents" >= 0
);
