// Nightly production summary (docs/NOTIFICATIONS.md §4, CAPACITY_RULES.md §10): loads X+1 and X+2
// the same way the dashboard does, runs buildSummary and enqueues one DAILY_SUMMARY per evening.

import { addDays, localDateOf } from "@/domain/dates";
import {
  buildSummary,
  type DailySummary,
  type SummaryDay,
  type SummaryOrder,
  type SummaryProduct,
} from "@/domain/summary";
import type { LocalDate } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";
import { enqueueNotification } from "./outbox";

export type SummaryJobResult =
  | { status: "empty" }
  | { status: "enqueued"; notificationId: string }
  | { status: "duplicate" };

/** Loads X+1 / X+2 (all orders with items, resolved limits, ALL products) and builds the summary. */
export async function loadDailySummary(client: DbClient, now: Date): Promise<DailySummary> {
  const today = localDateOf(now);
  const dates = [addDays(today, 1), addDays(today, 2)];
  const range = { gte: toDbDate(dates[0]), lte: toDbDate(dates[1]) };

  const [settings, productRows, openDates, overrides, orders] = await Promise.all([
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

  const days: Record<LocalDate, SummaryDay> = {};
  for (const date of dates) {
    const row = openByDate.get(date);
    const productLimits: Record<string, number> = {};
    for (const p of productRows) {
      if (p.capacityMode !== "INDEPENDENT") continue;
      const limit = overrideByKey.get(`${date}|${p.id}`) ?? p.dailyLimit;
      if (limit === null || limit === undefined) {
        throw new Error(`INDEPENDENT product "${p.id}" has no daily limit`);
      }
      productLimits[p.id] = limit;
    }
    days[date] = {
      date,
      isOpen: row?.isOpen ?? false,
      limits: {
        doughLimitG: row?.doughLimitG ?? settings.defaultDoughLimitG,
        deliveryEnabled: row?.deliveryEnabled ?? true,
        deliveryLimit: row?.deliveryLimit ?? settings.defaultDeliveryLimit,
        productLimits,
      },
      orders: ordersByDate.get(date) ?? [],
    };
  }

  return buildSummary({ today, days, products });
}

/** Enqueues tonight's summary email unless there is nothing to say or it was already enqueued. */
export async function enqueueDailySummary(client: DbClient, now: Date): Promise<SummaryJobResult> {
  const summary = await loadDailySummary(client, now);
  if (summary.isEmpty) return { status: "empty" };
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const result = await client.$transaction((tx) =>
    enqueueNotification(tx, {
      kind: "DAILY_SUMMARY",
      dedupeKey: `summary:${summary.tomorrow}`,
      payload: { ...summary, siteUrl } as unknown as Prisma.InputJsonValue,
      now,
    }),
  );
  return result.created ? { status: "enqueued", notificationId: result.id } : { status: "duplicate" };
}
