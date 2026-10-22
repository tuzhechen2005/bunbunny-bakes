// Shared helpers for db tests. Always the *_test database (see testDbUrl.ts).

import { randomBytes } from "node:crypto";
import { lineTotal } from "@/domain/pricing";
import type { Fulfillment, LocalDate, OrderStatus } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import { createPrismaClient, type DbClient } from "@/server/db";
import { toDbDate } from "@/server/dbDates";
import { DEFAULT_PRODUCTS } from "../../prisma/seed";
import { testDatabaseUrl } from "./testDbUrl";

export const TEST_DATABASE_URL = testDatabaseUrl();

/** Client for the test database. Call `db.$disconnect()` in afterAll. */
export const db: DbClient = createPrismaClient(TEST_DATABASE_URL);

/** Empties every table (keeps the schema and migration history). */
export async function resetDb(client: DbClient = db): Promise<void> {
  const rows = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function createSettings(data: Omit<Prisma.SettingCreateInput, "id"> = {}) {
  return db.setting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export interface DefaultProductIds {
  redBean: string;
  rockCheese: string;
  cheeseHorn: string;
  brulee: string;
}

/** The four seed products (CAPACITY_RULES §3.1). */
export async function createDefaultProducts(): Promise<DefaultProductIds> {
  const ids: string[] = [];
  for (const p of DEFAULT_PRODUCTS) {
    const created = await db.product.create({ data: { ...p, description: "test" } });
    ids.push(created.id);
  }
  return { redBean: ids[0], rockCheese: ids[1], cheeseHorn: ids[2], brulee: ids[3] };
}

export function createOpenDate(
  date: LocalDate,
  data: Omit<Prisma.OpenDateCreateInput, "date"> = {},
) {
  return db.openDate.create({ data: { date: toDbDate(date), ...data } });
}

export interface OrderFactoryInput {
  date: LocalDate;
  items: { productId: string; qty: number }[];
  status?: OrderStatus;
  fulfillment?: Fulfillment;
  wechatId?: string;
  createdAt?: Date;
}

/** Inserts an order with items. The OpenDate row must exist. Not the real create flow. */
export async function createOrder(input: OrderFactoryInput) {
  const pickupDate = toDbDate(input.date);
  const max = await db.order.aggregate({ where: { pickupDate }, _max: { seq: true } });
  const seq = (max._max.seq ?? 0) + 1;
  const products = await db.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = input.items.map((i) => {
    const p = byId.get(i.productId);
    if (!p) throw new Error(`createOrder: unknown product ${i.productId}`);
    const snapshot = {
      unitPriceCents: p.unitPriceCents,
      bundleSize: p.bundleSize,
      bundlePriceCents: p.bundlePriceCents,
    };
    return {
      productId: p.id,
      nameSnapshot: p.name,
      qty: i.qty,
      ...snapshot,
      lineTotalCents: lineTotal(i.qty, snapshot),
    };
  });
  const subtotal = items.reduce((s, i) => s + i.lineTotalCents, 0);
  const fulfillment = input.fulfillment ?? "PICKUP";
  const fee = fulfillment === "DELIVERY" && subtotal < 2500 ? 500 : 0;
  const mmdd = input.date.slice(5, 7) + input.date.slice(8, 10);
  return db.order.create({
    data: {
      openDate: { connect: { date: pickupDate } },
      seq,
      orderNo: `${mmdd}-${String(seq).padStart(3, "0")}`,
      viewToken: randomBytes(32).toString("base64url"),
      wechatId: input.wechatId ?? `wx_${randomBytes(4).toString("hex")}`,
      fulfillment,
      status: input.status ?? "NEW",
      subtotalCents: subtotal,
      deliveryFeeCents: fee,
      totalCents: subtotal + fee,
      cutoffAt: new Date("2026-01-01T02:00:00Z"),
      source: "WEB",
      createdAt: input.createdAt,
      items: { create: items },
    },
    include: { items: true },
  });
}
