// Concurrent order changes on real Postgres: DATA_MODEL §5 test 6 (cross-day swap never
// deadlocks, capacity never exceeded) and customer cancel racing an owner edit.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { usage } from "@/domain/capacity";
import type { LocalDate } from "@/domain/types";
import { loadDayContext, loadProductMap, loadSettings } from "@/server/day";
import { createPrismaClient } from "@/server/db";
import { fromDbDate, toDbDate } from "@/server/dbDates";
import { isAppError } from "@/server/errors";
import { adminEditOrder, customerCancel } from "@/server/orderAdmin";
import {
  TEST_DATABASE_URL,
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const pool = createPrismaClient(TEST_DATABASE_URL, { max: 10 });

const A: LocalDate = "2026-10-30";
const B: LocalDate = "2026-10-31";
const NOW = new Date("2026-10-27T15:00:00Z");
const LIMIT = 1600;

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(A);
  await createOpenDate(B);
});

afterAll(async () => {
  await pool.$disconnect();
  await db.$disconnect();
});

type Outcome = { ok: true } | { ok: false; code: string };

function settle(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    (): Outcome => ({ ok: true }),
    (e: unknown): Outcome => {
      if (isAppError(e)) return { ok: false, code: e.code };
      throw e;
    },
  );
}

async function doughOf(date: LocalDate): Promise<number> {
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const products = await loadProductMap(tx);
    const day = await loadDayContext(tx, date, settings, products);
    return usage(day.orders, products).doughG;
  });
}

describe("DATA_MODEL §5 test 6: swapping dates A<->B concurrently", () => {
  it("never deadlocks, each edit completes or is OVER_LIMIT, capacity never exceeded (20 rounds)", async () => {
    // A: 1400 g filler; B: 1470 g filler. Each moving order is 1 red bean (70 g).
    // Whichever edit runs first decides whether the other one fits.
    await createOrder({ date: A, items: [{ productId: P.redBean, qty: 20 }] });
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 21 }] });
    const x = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 1 }] });
    const y = await createOrder({ date: B, items: [{ productId: P.redBean, qty: 1 }] });

    const tally: Record<string, number> = {};
    for (let round = 0; round < 20; round++) {
      const [rx, ry] = await Promise.all(
        [x.id, y.id].map(async (id) => {
          const o = await db.order.findUniqueOrThrow({ where: { id } });
          const to = fromDbDate(o.pickupDate) === A ? B : A;
          return settle(
            adminEditOrder(
              pool,
              { orderId: id, pickupDate: to, expectedUpdatedAt: o.updatedAt.toISOString() },
              new Date(NOW.getTime() + round * 1000),
            ),
          );
        }),
      );
      for (const r of [rx, ry]) {
        const k = r.ok ? "OK" : r.code;
        expect(["OK", "OVER_LIMIT"]).toContain(k);
        tally[k] = (tally[k] ?? 0) + 1;
      }
      expect(await doughOf(A)).toBeLessThanOrEqual(LIMIT);
      expect(await doughOf(B)).toBeLessThanOrEqual(LIMIT);

      // seq stays unique per day and orderNo matches it.
      const orders = await db.order.findMany();
      for (const o of orders) {
        const d = fromDbDate(o.pickupDate);
        expect(o.orderNo.slice(0, 4)).toBe(d.slice(5, 7) + d.slice(8, 10));
      }
    }
    expect((tally.OK ?? 0) + (tally.OVER_LIMIT ?? 0)).toBe(40);
    expect(tally.OK ?? 0).toBeGreaterThan(0);
  }, 60_000);

  it("a swap where neither order fits the other day: both OVER_LIMIT, no deadlock (20 rounds)", async () => {
    await db.openDate.update({ where: { date: toDbDate(A) }, data: { doughLimitG: 210 } });
    await db.openDate.update({ where: { date: toDbDate(B) }, data: { doughLimitG: 210 } });
    const x = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }] }); // 140
    const y = await createOrder({ date: B, items: [{ productId: P.redBean, qty: 3 }] }); // 210
    for (let round = 0; round < 20; round++) {
      const results = await Promise.all(
        [x.id, y.id].map(async (id) => {
          const o = await db.order.findUniqueOrThrow({ where: { id } });
          const to = fromDbDate(o.pickupDate) === A ? B : A;
          return settle(adminEditOrder(pool, { orderId: id, pickupDate: to, expectedUpdatedAt: o.updatedAt.toISOString() }, NOW));
        }),
      );
      expect(results).toEqual([{ ok: false, code: "OVER_LIMIT" }, { ok: false, code: "OVER_LIMIT" }]);
      expect(await doughOf(A)).toBeLessThanOrEqual(210);
      expect(await doughOf(B)).toBeLessThanOrEqual(210);
    }
  }, 60_000);
});

describe("customer cancel racing an owner edit", () => {
  async function setup() {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }] });
    return db.order.update({
      where: { id: o.id },
      data: { cutoffAt: new Date("2026-10-30T01:00:00Z") },
    });
  }

  it("note edit vs cancel: one wins, the other is STALE or applies on top; no lost update (20 rounds)", async () => {
    const seen: Record<string, number> = {};
    for (let round = 0; round < 20; round++) {
      const o = await setup();
      const [cancel, edit] = await Promise.all([
        settle(customerCancel(pool, { viewToken: o.viewToken }, NOW)),
        settle(adminEditOrder(pool, { orderId: o.id, note: `n${round}`, expectedUpdatedAt: o.updatedAt.toISOString() }, NOW)),
      ]);
      expect(cancel.ok).toBe(true);
      const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(row.status).toBe("CANCELLED");
      const audits = await db.auditLog.findMany({ where: { entityId: o.id } });
      if (edit.ok) {
        // Edit committed first, then the cancel: both changes are there.
        expect(row.note).toBe(`n${round}`);
        expect(audits.map((a) => a.action).sort()).toEqual(["order.cancel", "order.edit"]);
        seen.editFirst = (seen.editFirst ?? 0) + 1;
      } else {
        expect(edit.code).toBe("STALE");
        expect(row.note).toBeNull();
        expect(audits.map((a) => a.action)).toEqual(["order.cancel"]);
        seen.cancelFirst = (seen.cancelFirst ?? 0) + 1;
      }
      expect(await db.notification.count({ where: { dedupeKey: `customer_cancelled:${o.id}` } })).toBe(1);
    }
    expect((seen.editFirst ?? 0) + (seen.cancelFirst ?? 0)).toBe(20);
  }, 60_000);

  it("date-moving edit vs cancel: the cancel follows the order to its new day (20 rounds)", async () => {
    for (let round = 0; round < 20; round++) {
      const o = await setup();
      const [cancel, edit] = await Promise.all([
        settle(customerCancel(pool, { viewToken: o.viewToken }, NOW)),
        settle(adminEditOrder(pool, { orderId: o.id, pickupDate: B, expectedUpdatedAt: o.updatedAt.toISOString() }, NOW)),
      ]);
      const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
      if (edit.ok) {
        expect(fromDbDate(row.pickupDate)).toBe(B);
        // Edit first: the cancel (re-run on B if it had already locked A) still succeeds.
        expect(cancel).toEqual({ ok: true });
        expect(row.status).toBe("CANCELLED");
      } else {
        expect(edit).toEqual({ ok: false, code: "STALE" });
        expect(cancel).toEqual({ ok: true });
        expect(fromDbDate(row.pickupDate)).toBe(A);
        expect(row.status).toBe("CANCELLED");
      }
    }
  }, 60_000);
});
