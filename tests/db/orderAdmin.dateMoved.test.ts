// The order moves to another day between the plain read of its pickupDate and the day lock.
// The transaction must re-run and lock the NEW day before checking capacity; a second move
// in the window -> STALE. Deterministic: a wrapper around lockOpenDates commits the move
// from another connection right before the lock is taken.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDate } from "@/domain/types";
import type { Tx } from "@/server/db";
import { createPrismaClient } from "@/server/db";
import { toDbDate } from "@/server/dbDates";
import { AppError } from "@/server/errors";
import { adminCorrectStatus, customerCancel } from "@/server/orderAdmin";
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

type Hook = (dates: LocalDate[]) => Promise<void>;

const hooks = vi.hoisted(() => ({
  /** Runs (from another connection) right before lockOpenDates; one entry per call. */
  beforeLock: [] as Hook[],
  /** Runs inside loadDayContext, i.e. while the transaction holds its day locks. */
  duringCapacity: null as null | ((date: LocalDate) => Promise<void>),
  lockCalls: [] as LocalDate[][],
}));

vi.mock("@/server/day", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/day")>();
  return {
    ...actual,
    lockOpenDates: async (tx: Tx, dates: LocalDate[]) => {
      hooks.lockCalls.push([...dates]);
      const hook = hooks.beforeLock.shift();
      if (hook) await hook(dates);
      return actual.lockOpenDates(tx, dates);
    },
    loadDayContext: async (...args: Parameters<typeof actual.loadDayContext>) => {
      if (hooks.duringCapacity) await hooks.duringCapacity(args[1]);
      return actual.loadDayContext(...args);
    },
  };
});

const A: LocalDate = "2026-10-30";
const B: LocalDate = "2026-10-31";
const C: LocalDate = "2026-11-02";
const NOW = new Date("2026-10-27T15:00:00Z");

/** Second client: the "concurrent" mover and the lock probe use their own connections. */
const other = createPrismaClient(TEST_DATABASE_URL, { max: 3 });

let P: DefaultProductIds;

beforeEach(async () => {
  hooks.beforeLock = [];
  hooks.duringCapacity = null;
  hooks.lockCalls = [];
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  await createOpenDate(A);
  await createOpenDate(B);
  await createOpenDate(C);
});

afterAll(async () => {
  await other.$disconnect();
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

/** Commits "move order to `to`" from another connection (as a concurrent edit would). */
function moveTo(orderId: string, to: LocalDate, seq: number): Hook {
  return async () => {
    await other.order.update({
      where: { id: orderId },
      data: { pickupDate: toDbDate(to), seq, orderNo: `moved-${seq}`, updatedAt: new Date(NOW.getTime() - 1000) },
    });
  };
}

/** true if another connection can NOT take `date`'s OpenDate lock right now. */
async function isLocked(date: LocalDate): Promise<boolean> {
  try {
    await other.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "OpenDate" WHERE "date" = ${date}::date FOR UPDATE NOWAIT`;
    });
    return false;
  } catch (e) {
    if (String(e).includes("55P03") || String(e).includes("could not obtain lock")) return true;
    throw e;
  }
}

describe("date moved between the plain read and the day lock", () => {
  it("correction CANCELLED -> NEW: re-runs, locks the new day, checks capacity there, succeeds", async () => {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }], status: "CANCELLED" });
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 20 }] }); // B: 1400 g, room for 140
    const moved = moveTo(o.id, B, 50);
    hooks.beforeLock.push(moved);
    const probes: Record<string, boolean> = {};
    hooks.duringCapacity = async (date) => {
      probes[date] = await isLocked(date);
    };

    const stamp = new Date(NOW.getTime() - 1000).toISOString(); // updatedAt after the move
    const res = await adminCorrectStatus(db, { orderId: o.id, to: "NEW", reason: "点错了", expectedUpdatedAt: stamp }, NOW);

    expect(res).toMatchObject({ status: "NEW", pickupDate: B });
    expect(hooks.lockCalls).toEqual([[A], [B]]); // first attempt on A, retry on B
    expect(probes).toEqual({ [B]: true }); // capacity was checked on B while B was locked
  });

  it("correction on a move to a full day: the retry checks the NEW day -> OVER_LIMIT", async () => {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }], status: "CANCELLED" });
    await createOrder({ date: B, items: [{ productId: P.redBean, qty: 22 }] }); // B: 1540 g
    hooks.beforeLock.push(moveTo(o.id, B, 50));
    const probes: Record<string, boolean> = {};
    hooks.duringCapacity = async (date) => {
      probes[date] = await isLocked(date);
    };
    const err = await errorOf(
      adminCorrectStatus(
        db,
        { orderId: o.id, to: "NEW", reason: "x", expectedUpdatedAt: new Date(NOW.getTime() - 1000).toISOString() },
        NOW,
      ),
    );
    expect(err.code).toBe("OVER_LIMIT");
    expect(err.extra?.violations).toEqual([{ kind: "DOUGH", date: B, limit: 1600, after: 1680, over: 80 }]);
    expect(probes).toEqual({ [B]: true });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELLED");
  });

  it("customer cancel follows the order to its new day", async () => {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 1 }] });
    await db.order.update({ where: { id: o.id }, data: { cutoffAt: new Date("2026-10-30T01:00:00Z") } });
    hooks.beforeLock.push(moveTo(o.id, B, 7));
    const res = await customerCancel(db, { viewToken: o.viewToken }, NOW);
    expect(res.alreadyCancelled).toBe(false);
    expect(hooks.lockCalls).toEqual([[A], [B]]);
    const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.pickupDate.toISOString()).toBe(toDbDate(B).toISOString());
  });

  it("a second move inside the retry window -> STALE; nothing is written", async () => {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 2 }], status: "CANCELLED" });
    hooks.beforeLock.push(moveTo(o.id, B, 50), moveTo(o.id, C, 60));
    const err = await errorOf(
      adminCorrectStatus(
        db,
        { orderId: o.id, to: "NEW", reason: "x", expectedUpdatedAt: new Date(NOW.getTime() - 1000).toISOString() },
        NOW,
      ),
    );
    expect(err.code).toBe("STALE");
    expect(hooks.lockCalls).toEqual([[A], [B]]);
    const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.pickupDate.toISOString()).toBe(toDbDate(C).toISOString());
    expect(await db.auditLog.count()).toBe(0);
  });

  it("customer cancel with two moves -> STALE", async () => {
    const o = await createOrder({ date: A, items: [{ productId: P.redBean, qty: 1 }] });
    await db.order.update({ where: { id: o.id }, data: { cutoffAt: new Date("2026-10-30T01:00:00Z") } });
    hooks.beforeLock.push(moveTo(o.id, B, 7), moveTo(o.id, C, 8));
    expect((await errorOf(customerCancel(db, { viewToken: o.viewToken }, NOW))).code).toBe("STALE");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("NEW");
    expect(await db.notification.count()).toBe(0);
  });
});
