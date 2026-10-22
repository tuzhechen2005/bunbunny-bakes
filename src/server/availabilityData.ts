// Builds the AvailabilityInput for src/domain/availability (CAPACITY_RULES.md §7, §7.1).
// Non-locking reads: the result is only for display / suggestions. Every order submit
// re-checks everything inside its own locked transaction.

import type { AvailabilityInput, OpenDay } from "@/domain/availability";
import { addDays, localDateOf } from "@/domain/dates";
import type { CartLine, DayLimits, Fulfillment } from "@/domain/types";
import type { DbClient } from "./db";
import { loadProductMap, loadSettings } from "./day";
import { fromDbDate, toDbDate } from "./dbDates";

/** Same window as the domain's visibleDays (today < date ≤ today + 60). */
const VISIBLE_DAYS = 60;

export interface LoadAvailabilityOptions {
  cart: CartLine[];
  fulfillment: Fulfillment;
  now: Date;
}

/**
 * Settings, ALL products (incl. PAUSED/ARCHIVED) and every open day with
 * today < date ≤ today + 60 (Chicago), each with all of its orders and resolved limits.
 *
 * Runs in one read-only REPEATABLE READ transaction so all reads see one consistent
 * snapshot. Takes no row locks.
 */
export async function loadAvailabilityInput(
  db: DbClient,
  { cart, fulfillment, now }: LoadAvailabilityOptions,
): Promise<AvailabilityInput> {
  const today = localDateOf(now);
  const from = toDbDate(addDays(today, 1));
  const to = toDbDate(addDays(today, VISIBLE_DAYS));

  return db.$transaction(
    async (tx) => {
      const settings = await loadSettings(tx);
      const products = await loadProductMap(tx);
      const openDates = await tx.openDate.findMany({
        where: { isOpen: true, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      });
      const dbDates = openDates.map((d) => d.date);
      const overrides = dbDates.length
        ? await tx.openDateProductLimit.findMany({ where: { date: { in: dbDates } } })
        : [];
      const orders = dbDates.length
        ? await tx.order.findMany({
            where: { pickupDate: { in: dbDates } },
            select: {
              id: true,
              pickupDate: true,
              status: true,
              fulfillment: true,
              items: { select: { productId: true, qty: true }, orderBy: { id: "asc" } },
            },
            orderBy: [{ pickupDate: "asc" }, { seq: "asc" }],
          })
        : [];

      const days: OpenDay[] = openDates.map((od) => {
        const date = fromDbDate(od.date);
        // Limit resolution mirrors loadDayContext (src/server/day.ts).
        const productLimits: Record<string, number> = {};
        for (const p of Object.values(products)) {
          if (p.capacityMode !== "INDEPENDENT") continue;
          const override = overrides.find((o) => o.productId === p.id && fromDbDate(o.date) === date);
          const limit = override?.limit ?? p.dailyLimit;
          if (limit === null || limit === undefined) {
            throw new Error(`INDEPENDENT product "${p.id}" has no daily limit`);
          }
          productLimits[p.id] = limit;
        }
        const limits: DayLimits = {
          doughLimitG: od.doughLimitG ?? settings.defaultDoughLimitG,
          deliveryEnabled: od.deliveryEnabled,
          deliveryLimit: od.deliveryLimit ?? settings.defaultDeliveryLimit,
          productLimits,
        };
        return {
          date,
          isOpen: od.isOpen,
          limits,
          orders: orders
            .filter((o) => fromDbDate(o.pickupDate) === date)
            .map((o) => ({
              id: o.id,
              status: o.status,
              fulfillment: o.fulfillment,
              items: o.items.map((i) => ({ productId: i.productId, qty: i.qty })),
            })),
        };
      });

      return {
        now,
        orderingEnabled: settings.orderingEnabled,
        cutoffTime: settings.cutoffTime,
        maxQtyPerItem: settings.maxQtyPerItem,
        products,
        cart,
        fulfillment,
        days,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 20_000 },
  );
}
