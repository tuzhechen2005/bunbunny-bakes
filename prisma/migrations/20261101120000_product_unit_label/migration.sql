ALTER TABLE "Product" ADD COLUMN "unitLabel" TEXT NOT NULL DEFAULT '个';
UPDATE "Product" SET "unitLabel" = '杯' WHERE "name" LIKE '%布蕾%';
