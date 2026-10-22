// A PUT that lowers the dough limit racing a customer order on the same date must never
// leave usage above the limit unless the owner confirmed warnings.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { updateOpenDate, loadCalendar } from "@/server/calendar";
import { createPrismaClient } from "@/server/db";
import { isAppError } from "@/server/errors";
import { createCustomerOrder } from "@/server/orders";
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
const DATE = "2026-10-30";
const NOW = new Date("2026-10-27T15:00:00Z");
let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
});

afterAll(async () => {
  await pool.$disconnect();
  await db.$disconnect();
});

const putBody = (doughLimitG: number | null, confirm?: boolean) => ({
  isOpen: true,
  doughLimitG,
  deliveryEnabled: true,
  deliveryLimit: null,
  productLimits: {},
  note: null,
  ...(confirm === undefined ? {} : { confirm }),
});

describe("calendar PUT vs customer order", () => {
  it("never leaves usage > limit without a confirmed warning", async () => {
    for (let round = 0; round < 8; round++) {
      await resetDb();
      await createSettings({ orderingEnabled: true });
      P = await createDefaultProducts();
      await createOpenDate(DATE, { doughLimitG: 1600 });
      await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 20 }] }); // 1400 g

      const [put, order] = await Promise.all([
        updateOpenDate(pool, DATE, putBody(1450), NOW).then(
          () => ({ ok: true as const }),
          (e: unknown) => {
            if (isAppError(e)) return { ok: false as const, code: e.code };
            throw e;
          },
        ),
        createCustomerOrder(
          pool,
          {
            items: [{ productId: P.redBean, qty: 1 }],
            pickupDate: DATE,
            fulfillment: "PICKUP",
            wechatId: `wx${round}`,
            note: null,
          },
          NOW,
        ).then(
          () => ({ ok: true as const }),
          (e: unknown) => {
            if (isAppError(e)) return { ok: false as const, code: e.code };
            throw e;
          },
        ),
      ]);

      const day = (await db.$transaction((tx) => loadCalendar(tx, DATE, DATE))).days[0];
      // Either the PUT lowered the limit first (the order was then refused) or the order
      // went first (the PUT then had a warning and, unconfirmed, was refused). Never both ok
      // with usage above the limit.
      expect(day.usage.doughG <= day.limits.doughLimitG, JSON.stringify({ put, order, day })).toBe(true);
      expect(put.ok !== order.ok || (put.ok && order.ok)).toBe(true);
      if (put.ok && order.ok) {
        // Both succeeded: only possible when the order (70 g, total 1470) fitted the new limit 1450? It does not.
        throw new Error("both succeeded although 1470 > 1450");
      }
    }
  });

  it("a confirmed PUT after an order may leave usage above the limit (owner's choice)", async () => {
    await createOpenDate(DATE, { doughLimitG: 1600 });
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 22 }] }); // 1540 g
    const day = await updateOpenDate(pool, DATE, putBody(1500, true), NOW);
    expect(day.over.dough).toBe(true);
  });
});
