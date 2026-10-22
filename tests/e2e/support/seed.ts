// Raw-SQL seeding helpers for the real-backend e2e (tests/e2e/full-flow.spec.ts).
// Playwright's CommonJS loader cannot import the generated Prisma client, so everything is `pg`.
// Targets TEST_DATABASE_URL (a *_test database, guarded by testDatabaseUrl).

import { createHash, randomBytes } from "node:crypto";
import { Client } from "pg";
import { testDatabaseUrl } from "../../db/testDbUrl";

export const OWNER_WECHAT = "bunbunny_bakes";

export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ---- Chicago dates ------------------------------------------------------------------------

const CHICAGO = "America/Chicago";

/** Today's calendar day in Chicago, "YYYY-MM-DD". */
export function chicagoToday(now: Date = new Date()): string {
  // en-CA formats as ISO year-month-day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function chicagoOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const v = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a Chicago wall-clock time. */
export function chicagoInstant(ymd: string, hh: number, mm: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - chicagoOffsetMs(wall);
  utc = wall - chicagoOffsetMs(utc);
  return new Date(utc);
}

/** CAPACITY_RULES §6: (pickupDate - leadDays) at 20:00 Chicago. */
export function cutoffAt(pickupDate: string, leadDays: number): Date {
  return chicagoInstant(addDays(pickupDate, -leadDays), 20, 0);
}

/** tomorrow, and the open dates tomorrow+1..+3 (their cutoffs, tomorrow 20:00 onwards, are ahead). */
export function openDates(): { tomorrow: string; d1: string; d2: string; d3: string } {
  const today = chicagoToday();
  return { tomorrow: addDays(today, 1), d1: addDays(today, 2), d2: addDays(today, 3), d3: addDays(today, 4) };
}

// ---- Seeding --------------------------------------------------------------------------------

export interface Seeded {
  products: { red: string; cheeseRock: string; wedge: string; brulee: string };
  dates: { tomorrow: string; d1: string; d2: string; d3: string };
}

interface SeedOptions {
  orderingEnabled?: boolean;
  /** Also open "tomorrow" (the admin dashboard's unconfirmed count looks at it). */
  openTomorrow?: boolean;
}

/** Truncate everything, then insert Setting, the 4 default products and the open dates. */
export async function resetAndSeed(opts: SeedOptions = {}): Promise<Seeded> {
  const dates = openDates();
  return withDb(async (c) => {
    await c.query(
      `TRUNCATE "AuditLog","Notification","OrderItem","Order","OpenDateProductLimit","OpenDate","Product",
                "Setting","AdminSession","PasswordReset","AdminUser","RateLimitHit" RESTART IDENTITY CASCADE`,
    );
    await c.query(
      `INSERT INTO "Setting" (id, "orderingEnabled", "ownerWechatId", "updatedAt") VALUES (1, $1, $2, now())`,
      [opts.orderingEnabled ?? true, OWNER_WECHAT],
    );
    // prisma/seed.ts DEFAULT_PRODUCTS (CAPACITY_RULES §2.3 prices, §3.1 capacity).
    const mk = async (
      name: string,
      price: number,
      bundlePrice: number,
      mode: string,
      extra: { doughG?: number; roundG?: number; piecesPerRound?: number; dailyLimit?: number; batchYield?: number },
      leadDays: number,
      sort: number,
    ) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO "Product" (id, name, description, "unitPriceCents", "bundleSize", "bundlePriceCents",
             "capacityMode", "doughG", "roundG", "piecesPerRound", "dailyLimit", "batchYield", "leadDays", "sortOrder", "updatedAt")
           VALUES (gen_random_uuid(), $1, '简介待补充', $2, 4, $3, $4::"CapacityMode", $5, $6, $7, $8, $9, $10, $11, now())
           RETURNING id`,
          [
            name,
            price,
            bundlePrice,
            mode,
            extra.doughG ?? null,
            extra.roundG ?? null,
            extra.piecesPerRound ?? null,
            extra.dailyLimit ?? null,
            extra.batchYield ?? null,
            leadDays,
            sort,
          ],
        )
      ).rows[0].id;
    const red = await mk("奶酥红豆包", 249, 899, "DOUGH_PER_UNIT", { doughG: 70 }, 1, 1);
    const cheeseRock = await mk("岩烧乳酪包", 249, 899, "DOUGH_PER_UNIT", { doughG: 70 }, 1, 2);
    const wedge = await mk("奶酪角", 299, 1099, "DOUGH_PER_ROUND", { roundG: 340, piecesPerRound: 4 }, 1, 3);
    const brulee = await mk("焦糖布蕾", 229, 899, "INDEPENDENT", { dailyLimit: 24, batchYield: 3 }, 2, 4);

    const toOpen = [dates.d1, dates.d2, dates.d3];
    if (opts.openTomorrow) toOpen.unshift(dates.tomorrow);
    for (const d of toOpen) await c.query(`INSERT INTO "OpenDate" (date, "updatedAt") VALUES ($1, now())`, [d]);
    return { products: { red, cheeseRock, wedge, brulee }, dates };
  });
}

export async function setOrderingEnabled(enabled: boolean): Promise<void> {
  await withDb((c) =>
    c.query(`UPDATE "Setting" SET "orderingEnabled" = $1, "updatedAt" = now() WHERE id = 1`, [enabled]),
  );
}

interface SeedItem {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  lineTotalCents: number;
}

export const ITEM = {
  red: (productId: string, qty: number): SeedItem => ({
    productId,
    name: "奶酥红豆包",
    qty,
    unitPriceCents: 249,
    bundleSize: 4,
    bundlePriceCents: 899,
    lineTotalCents: Math.floor(qty / 4) * 899 + (qty % 4) * 249,
  }),
  wedge: (productId: string, qty: number): SeedItem => ({
    productId,
    name: "奶酪角",
    qty,
    unitPriceCents: 299,
    bundleSize: 4,
    bundlePriceCents: 1099,
    lineTotalCents: Math.floor(qty / 4) * 1099 + (qty % 4) * 299,
  }),
};

/** Inserts one order with its items; returns { id, orderNo, viewToken }. */
export async function insertOrder(opts: {
  date: string;
  wechatId: string;
  status?: string;
  items: SeedItem[];
}): Promise<{ id: string; orderNo: string; viewToken: string }> {
  return withDb(async (c) => {
    const seq = (
      await c.query<{ seq: number }>(
        `UPDATE "OpenDate" SET "lastSeq" = "lastSeq" + 1 WHERE date = $1 RETURNING "lastSeq" AS seq`,
        [opts.date],
      )
    ).rows[0].seq;
    const orderNo = `${opts.date.slice(5, 7)}${opts.date.slice(8)}-${String(seq).padStart(3, "0")}`;
    const viewToken = randomBytes(32).toString("base64url");
    const subtotal = opts.items.reduce((s, i) => s + i.lineTotalCents, 0);
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO "Order" (id, "pickupDate", seq, "orderNo", "viewToken", "wechatId", fulfillment, status,
           "subtotalCents", "deliveryFeeCents", "totalCents", "cutoffAt", source, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PICKUP', $6::"OrderStatus", $7, 0, $7, $8, 'WEB', now())
         RETURNING id`,
        [opts.date, seq, orderNo, viewToken, opts.wechatId, opts.status ?? "NEW", subtotal, cutoffAt(opts.date, 1)],
      )
    ).rows[0].id;
    for (const i of opts.items) {
      await c.query(
        `INSERT INTO "OrderItem" (id, "orderId", "productId", "nameSnapshot", qty, "unitPriceCents", "bundleSize", "bundlePriceCents", "lineTotalCents")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, i.productId, i.name, i.qty, i.unitPriceCents, i.bundleSize, i.bundlePriceCents, i.lineTotalCents],
      );
    }
    return { id, orderNo, viewToken };
  });
}

/** Fills a day to exactly the default 1600 g: 18 red bean (1260 g) + 4 wedges (one 340 g round). */
export async function fillDay(date: string, products: Seeded["products"]): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await insertOrder({ date, wechatId: `full_wx_${i}`, status: "CONFIRMED", items: [ITEM.red(products.red, 6)] });
  }
  await insertOrder({ date, wechatId: "full_wx_3", status: "CONFIRMED", items: [ITEM.wedge(products.wedge, 4)] });
}

/** Creates an admin and a session; returns the raw cookie value for `bb_session`. */
export async function createAdminSession(username = "e2e-full-flow"): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await withDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'not-a-real-hash', now())
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
      [username],
    );
    await c.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [tokenHash, rows[0].id],
    );
  });
  return token;
}
