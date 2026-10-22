// updatedAt is the optimistic-concurrency token for admin mutations, so every write must
// move it strictly forward: updatedAt = max(now, previous updatedAt + 1 ms). Otherwise two
// writes in the same millisecond (or a clock that stepped back) leave the token unchanged
// and a client holding the old value would not get STALE.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LocalDate, OrderStatus } from "@/domain/types";
import { AppError } from "@/server/errors";
import {
  adminChangeStatus,
  adminCorrectStatus,
  adminEditOrder,
  adminSetPayment,
  customerCancel,
} from "@/server/orderAdmin";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const DATE: LocalDate = "2026-10-30";
const CUTOFF = new Date("2026-10-30T01:00:00Z");
const PREV = new Date("2026-10-27T15:00:00.000Z");
const PREV_PLUS_1 = new Date(PREV.getTime() + 1);
const EARLIER = new Date("2026-10-27T14:00:00.000Z");
const LATER = new Date("2026-10-27T16:00:00.000Z");

let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(DATE);
});

afterAll(async () => {
  await db.$disconnect();
});

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError, but the call succeeded");
}

/** Order whose stored updatedAt is exactly PREV. */
async function placed(status: OrderStatus = "NEW") {
  const o = await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 2 }], status });
  return db.order.update({ where: { id: o.id }, data: { updatedAt: PREV, cutoffAt: CUTOFF } });
}

const stampOf = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

type Mutation = (o: { id: string; viewToken: string }, expected: string, now: Date) => Promise<unknown>;

const cases: { name: string; status: OrderStatus; run: Mutation; again?: Mutation }[] = [
  {
    name: "adminChangeStatus",
    status: "NEW",
    run: (o, e, now) => adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: e }, now),
    again: (o, e, now) => adminChangeStatus(db, { orderId: o.id, to: "CONFIRMED", expectedUpdatedAt: e }, now),
  },
  {
    name: "adminCorrectStatus",
    status: "REJECTED",
    run: (o, e, now) => adminCorrectStatus(db, { orderId: o.id, to: "NEW", reason: "点错了", expectedUpdatedAt: e }, now),
    again: (o, e, now) => adminChangeStatus(db, { orderId: o.id, to: "CONTACTED", expectedUpdatedAt: e }, now),
  },
  {
    name: "adminSetPayment",
    status: "NEW",
    run: (o, e, now) => adminSetPayment(db, { orderId: o.id, paid: true, method: "ZELLE", expectedUpdatedAt: e }, now),
    again: (o, e, now) => adminSetPayment(db, { orderId: o.id, paid: false, expectedUpdatedAt: e }, now),
  },
  {
    name: "adminEditOrder",
    status: "NEW",
    run: (o, e, now) => adminEditOrder(db, { orderId: o.id, note: "晚点取", expectedUpdatedAt: e }, now),
    again: (o, e, now) => adminEditOrder(db, { orderId: o.id, note: "再晚点", expectedUpdatedAt: e }, now),
  },
  {
    name: "customerCancel",
    status: "NEW",
    run: (o, _e, now) => customerCancel(db, { viewToken: o.viewToken }, now),
  },
];

describe("updatedAt always moves forward", () => {
  for (const c of cases) {
    describe(c.name, () => {
      it("now > previous: updatedAt = now", async () => {
        const o = await placed(c.status);
        await c.run(o, PREV.toISOString(), LATER);
        expect(await stampOf(o.id)).toBe(LATER.toISOString());
      });

      it("now == previous (same millisecond): updatedAt = previous + 1 ms", async () => {
        const o = await placed(c.status);
        await c.run(o, PREV.toISOString(), PREV);
        expect(await stampOf(o.id)).toBe(PREV_PLUS_1.toISOString());
      });

      it("now < previous (clock stepped back): updatedAt = previous + 1 ms", async () => {
        const o = await placed(c.status);
        await c.run(o, PREV.toISOString(), EARLIER);
        expect(await stampOf(o.id)).toBe(PREV_PLUS_1.toISOString());
      });

      if (c.again) {
        const again = c.again;
        it("a client still holding the old token gets STALE after a same-millisecond write", async () => {
          const o = await placed(c.status);
          const res = (await c.run(o, PREV.toISOString(), PREV)) as { updatedAt: string };
          expect(res.updatedAt).toBe(PREV_PLUS_1.toISOString());
          const err = await errorOf(again(o, PREV.toISOString(), PREV));
          expect(err.code).toBe("STALE");
          // The returned token works.
          await again(o, res.updatedAt, PREV);
          expect(await stampOf(o.id)).toBe(new Date(PREV.getTime() + 2).toISOString());
        });
      }
    });
  }
});
