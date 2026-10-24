// Data for the admin dashboard (PAGES.md /admin 首页, API_SPEC GET /api/admin/dashboard).
// Reads only; capacity and summary numbers come from src/domain so they match the nightly email.

import { usage } from "@/domain/capacity";
import { addDays, localDateOf } from "@/domain/dates";
import {
  buildSummary,
  type BatchLine,
  type SummaryDay,
  type SummaryOrder,
  type SummaryProduct,
} from "@/domain/summary";
import type { LocalDate, OrderStatus } from "@/domain/types";
import type { DbClient } from "./db";
import { writeAudit } from "./audit";
import { loadSettings } from "./day";
import { fromDbDate, toDbDate } from "./dbDates";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
];

export interface DayCard {
  isOpen: boolean;
  products: {
    productId: string;
    name: string;
    qty: number;
    rounds: { rounds: number; leftover: number } | null;
  }[];
  doughG: number;
  doughLimitG: number;
  independent: { productId: string; name: string; qty: number; limit: number }[];
  deliveries: number;
  deliveryLimit: number;
  deliveryEnabled: boolean;
  byStatus: Record<OrderStatus, number>;
}

export interface Next14Day {
  date: LocalDate;
  isOpen: boolean;
  doughG: number;
  doughLimitG: number;
  deliveries: number;
  deliveryLimit: number;
  over: boolean;
}

export interface Dashboard {
  orderingEnabled: boolean;
  today: LocalDate;
  tomorrow: LocalDate;
  days: Record<LocalDate, DayCard>;
  tonightBrulee: BatchLine[];
  unconfirmedTomorrow: number;
  failedNotifications: number;
  next14: Next14Day[];
}

interface DayData {
  day: SummaryDay;
  deliveryEnabled: boolean;
  deliveryLimit: number;
}

/** Everything the dashboard shows, as of `now`. */
export async function loadDashboard(client: DbClient, now: Date): Promise<Dashboard> {
  const today = localDateOf(now);
  const tomorrow = addDays(today, 1);
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const from = toDbDate(dates[0]);
  const to = toDbDate(dates[dates.length - 1]);
  const range = { gte: from, lte: to };

  const [settings, productRows, openDates, overrides, orders, failedNotifications] =
    await Promise.all([
      client.setting.findUnique({ where: { id: 1 } }),
      client.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      client.openDate.findMany({ where: { date: range } }),
      client.openDateProductLimit.findMany({ where: { date: range } }),
      client.order.findMany({
        where: { pickupDate: range },
        select: {
          id: true,
          orderNo: true,
          wechatId: true,
          pickupDate: true,
          status: true,
          fulfillment: true,
          items: { select: { productId: true, qty: true }, orderBy: { id: "asc" } },
        },
        orderBy: { seq: "asc" },
      }),
      client.notification.count({ where: { status: "FAILED" } }),
    ]);
  if (!settings) throw new Error("Setting row (id = 1) is missing; run `npm run db:seed`");

  const products: Record<string, SummaryProduct> = {};
  for (const p of productRows) {
    products[p.id] = {
      id: p.id,
      capacityMode: p.capacityMode,
      doughG: p.doughG,
      roundG: p.roundG,
      piecesPerRound: p.piecesPerRound,
      dailyLimit: p.dailyLimit,
      leadDays: p.leadDays,
      name: p.name,
      sortOrder: p.sortOrder,
      batchYield: p.batchYield,
    };
  }

  const openByDate = new Map(openDates.map((o) => [fromDbDate(o.date), o]));
  const overrideByKey = new Map(
    overrides.map((o) => [`${fromDbDate(o.date)}|${o.productId}`, o.limit]),
  );
  const ordersByDate = new Map<LocalDate, SummaryOrder[]>();
  for (const o of orders) {
    const date = fromDbDate(o.pickupDate);
    const list = ordersByDate.get(date) ?? [];
    list.push({
      id: o.id,
      orderNo: o.orderNo,
      wechatId: o.wechatId,
      status: o.status,
      fulfillment: o.fulfillment,
      items: o.items.map((i) => ({ productId: i.productId, qty: i.qty })),
    });
    ordersByDate.set(date, list);
  }

  const dayData = new Map<LocalDate, DayData>();
  const summaryDays: Record<LocalDate, SummaryDay> = {};
  for (const date of dates) {
    const row = openByDate.get(date);
    const productLimits: Record<string, number> = {};
    for (const p of productRows) {
      // An archived product can no longer be ordered: its limit is not shown;
      // orders already placed stay in the order list and the baking lines.
      if (p.capacityMode !== "INDEPENDENT" || p.status === "ARCHIVED") continue;
      const limit = overrideByKey.get(`${date}|${p.id}`) ?? p.dailyLimit;
      if (limit === null || limit === undefined) {
        throw new Error(`INDEPENDENT product "${p.id}" has no daily limit`);
      }
      productLimits[p.id] = limit;
    }
    const deliveryEnabled = row?.deliveryEnabled ?? true;
    const deliveryLimit = row?.deliveryLimit ?? settings.defaultDeliveryLimit;
    const day: SummaryDay = {
      date,
      isOpen: row?.isOpen ?? false,
      limits: {
        doughLimitG: row?.doughLimitG ?? settings.defaultDoughLimitG,
        deliveryEnabled,
        deliveryLimit,
        productLimits,
      },
      orders: ordersByDate.get(date) ?? [],
    };
    summaryDays[date] = day;
    dayData.set(date, { day, deliveryEnabled, deliveryLimit });
  }

  // buildSummary reports the bread of "today + 1": call it for today (-> tomorrow's bread and
  // tonight's brûlée) and for yesterday (-> today's bread), so both cards use the same code
  // as the nightly email.
  const summaryForTomorrow = buildSummary({ today, days: summaryDays, products });
  const summaryForToday = buildSummary({ today: addDays(today, -1), days: summaryDays, products });

  function card(date: LocalDate, bread: ReturnType<typeof buildSummary>["bread"]): DayCard {
    const data = dayData.get(date)!;
    const { day } = data;
    const u = usage(day.orders, products);
    const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
      OrderStatus,
      number
    >;
    for (const o of day.orders) byStatus[o.status] += 1;
    const hasOrders = day.orders.length > 0;
    const independent = productRows
      .filter((p) => p.capacityMode === "INDEPENDENT" && p.status !== "ARCHIVED")
      .map((p) => ({
        productId: p.id,
        name: p.name,
        qty: u.products[p.id] ?? 0,
        limit: day.limits.productLimits[p.id],
      }))
      .filter((p) => day.isOpen || p.qty > 0 || hasOrders);
    return {
      isOpen: day.isOpen,
      products: (bread?.lines ?? []).map((l) => ({
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        rounds: l.rounds,
      })),
      doughG: u.doughG,
      doughLimitG: day.limits.doughLimitG,
      independent,
      deliveries: u.deliveries,
      deliveryLimit: data.deliveryLimit,
      deliveryEnabled: data.deliveryEnabled,
      byStatus,
    };
  }

  const next14: Next14Day[] = dates.map((date) => {
    const { day } = dayData.get(date)!;
    const u = usage(day.orders, products);
    const productOver = Object.entries(day.limits.productLimits).some(
      ([id, limit]) => (u.products[id] ?? 0) > limit,
    );
    const deliveryOver = u.deliveries > day.limits.deliveryLimit;
    return {
      date,
      isOpen: day.isOpen,
      doughG: u.doughG,
      doughLimitG: day.limits.doughLimitG,
      deliveries: u.deliveries,
      deliveryLimit: day.limits.deliveryLimit,
      over: u.doughG > day.limits.doughLimitG || productOver || deliveryOver,
    };
  });

  const unconfirmedTomorrow = (ordersByDate.get(tomorrow) ?? []).filter(
    (o) => o.status === "NEW" || o.status === "CONTACTED",
  ).length;

  return {
    orderingEnabled: settings.orderingEnabled,
    today,
    tomorrow,
    days: {
      [today]: card(today, summaryForToday.bread),
      [tomorrow]: card(tomorrow, summaryForTomorrow.bread),
    },
    tonightBrulee: summaryForTomorrow.tonight.lines,
    unconfirmedTomorrow,
    failedNotifications,
    next14,
  };
}

/** Switches ordering on/off and records it in the audit log, in one transaction. */
export async function setOrderingEnabled(
  client: DbClient,
  enabled: boolean,
  now: Date,
): Promise<{ orderingEnabled: boolean }> {
  return client.$transaction(async (tx) => {
    const before = await loadSettings(tx);
    const updated = await tx.setting.update({ where: { id: 1 }, data: { orderingEnabled: enabled } });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "ordering.toggle",
      entityType: "Setting",
      entityId: "1",
      before: { orderingEnabled: before.orderingEnabled },
      after: { orderingEnabled: updated.orderingEnabled },
      at: now,
    });
    return { orderingEnabled: updated.orderingEnabled };
  });
}
