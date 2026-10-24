// Admin calendar: per-day limits, usage and the PUT /api/admin/dates/{date} update
// (PAGES.md /admin/calendar, API_SPEC.md, CAPACITY_RULES §3–§5, D23, D45).

import { z } from "zod";
import { usage as computeUsage } from "@/domain/capacity";
import { addDays, compareLocalDate, isLocalDate } from "@/domain/dates";
import { OCCUPYING_STATUSES, type DayOrder, type LocalDate, type Usage } from "@/domain/types";
import { copy } from "@/copy";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { loadProductMap, loadSettings, lockOpenDate, type ProductInfoMap } from "./day";
import { fromDbDate, toDbDate } from "./dbDates";
import { AppError } from "./errors";
import { issuesToFields } from "./orderSchemas";

/** Inclusive number of days a GET may cover. */
export const MAX_RANGE_DAYS = 92;
export const CALENDAR_NOTE_MAX = 200;
const LIMIT_MAX = 1_000_000;

export interface CalendarDay {
  date: LocalDate;
  isOpen: boolean;
  hasRow: boolean;
  note: string | null;
  limits: {
    doughLimitG: number;
    deliveryEnabled: boolean;
    deliveryLimit: number;
    productLimits: Record<string, number>;
  };
  overrides: {
    doughLimitG: number | null;
    deliveryLimit: number | null;
    productLimits: Record<string, number | null>;
  };
  usage: Usage;
  /** Occupying (NEW/CONTACTED/CONFIRMED/…) orders on that day. */
  orderCount: number;
  over: { dough: boolean; products: string[]; delivery: boolean };
}

export interface CalendarResponse {
  independentProducts: { id: string; name: string }[];
  days: CalendarDay[];
}

export type DateWarning =
  | { kind: "BELOW_USAGE"; what: "DOUGH" | "DELIVERY"; limit: number; used: number }
  | { kind: "BELOW_USAGE"; what: "PRODUCT"; productId: string; limit: number; used: number }
  | { kind: "HAS_ORDERS"; count: number };

const fieldError = (fields: Record<string, string>) =>
  new AppError("VALIDATION", { extra: { fields } });

/** Query schema for GET /api/admin/calendar. */
export const calendarQuerySchema = z
  .object({
    from: z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" }),
    to: z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" }),
  })
  .superRefine((q, ctx) => {
    if (!isLocalDate(q.from) || !isLocalDate(q.to)) return;
    if (compareLocalDate(q.from, q.to) > 0) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "to must not be before from" });
    } else if (compareLocalDate(addDays(q.from, MAX_RANGE_DAYS - 1), q.to) < 0) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `At most ${MAX_RANGE_DAYS} days` });
    }
  });

const limitInt = z.number().int().min(0).max(LIMIT_MAX);

export const dateUpdateSchema = z.object({
  isOpen: z.boolean(),
  doughLimitG: limitInt.nullable(),
  deliveryEnabled: z.boolean(),
  deliveryLimit: limitInt.nullable(),
  productLimits: z.record(z.uuid(), limitInt.nullable()),
  note: z
    .string()
    .trim()
    .refine((s) => [...s].length <= CALENDAR_NOTE_MAX, {
      message: `At most ${CALENDAR_NOTE_MAX} characters`,
    })
    .nullable()
    .transform((s) => (s ? s : null)),
  confirm: z.boolean().optional(),
});
export type DateUpdateInput = z.input<typeof dateUpdateSchema>;

/** Days of [from, to], inclusive. */
function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; compareLocalDate(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Calendar days for [from, to] with CURRENT product settings (D45). Run inside a transaction for a consistent read. */
export async function loadCalendar(
  tx: Tx,
  from: LocalDate,
  to: LocalDate,
  preloaded?: { products: ProductInfoMap },
): Promise<CalendarResponse> {
  const settings = await loadSettings(tx);
  const products = preloaded?.products ?? (await loadProductMap(tx));
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  // Sequential: one transaction = one connection.
  const openDates = await tx.openDate.findMany({ where: { date: range } });
  const limitRows = await tx.openDateProductLimit.findMany({ where: { date: range } });
  const orders = await tx.order.findMany({
    where: { pickupDate: range },
    select: {
      id: true,
      pickupDate: true,
      status: true,
      fulfillment: true,
      items: { select: { productId: true, qty: true }, orderBy: { id: "asc" } },
    },
    orderBy: { seq: "asc" },
  });

  const rowByDate = new Map(openDates.map((r) => [fromDbDate(r.date), r]));
  const overridesByDate = new Map<LocalDate, Map<string, number>>();
  for (const l of limitRows) {
    const d = fromDbDate(l.date);
    const m = overridesByDate.get(d) ?? new Map<string, number>();
    m.set(l.productId, l.limit);
    overridesByDate.set(d, m);
  }
  const ordersByDate = new Map<LocalDate, DayOrder[]>();
  for (const o of orders) {
    const d = fromDbDate(o.pickupDate);
    const list = ordersByDate.get(d) ?? [];
    list.push({
      id: o.id,
      status: o.status,
      fulfillment: o.fulfillment,
      items: o.items.map((i) => ({ productId: i.productId, qty: i.qty })),
    });
    ordersByDate.set(d, list);
  }

  const independent = Object.values(products).filter(
    (p) => p.capacityMode === "INDEPENDENT" && p.status !== "ARCHIVED",
  );

  const days = eachDate(from, to).map((date): CalendarDay => {
    const row = rowByDate.get(date) ?? null;
    const dayOrders = ordersByDate.get(date) ?? [];
    const overrideMap = overridesByDate.get(date) ?? new Map<string, number>();
    const u = computeUsage(dayOrders, products);

    const limits = {
      doughLimitG: row?.doughLimitG ?? settings.defaultDoughLimitG,
      deliveryEnabled: row?.deliveryEnabled ?? true,
      deliveryLimit: row?.deliveryLimit ?? settings.defaultDeliveryLimit,
      productLimits: {} as Record<string, number>,
    };
    const overrides = {
      doughLimitG: row?.doughLimitG ?? null,
      deliveryLimit: row?.deliveryLimit ?? null,
      productLimits: {} as Record<string, number | null>,
    };
    const overProducts: string[] = [];
    for (const p of Object.values(products)) {
      if (p.capacityMode !== "INDEPENDENT") continue;
      const override = overrideMap.get(p.id) ?? null;
      const limit = override ?? p.dailyLimit ?? 0;
      // Archived products cannot be ordered any more: no limit row, and no red day for them.
      if (p.status === "ARCHIVED") continue;
      limits.productLimits[p.id] = limit;
      overrides.productLimits[p.id] = override;
      if ((u.products[p.id] ?? 0) > limit) overProducts.push(p.id);
    }

    return {
      date,
      isOpen: row?.isOpen ?? false,
      hasRow: row !== null,
      note: row?.note ?? null,
      limits,
      overrides,
      usage: u,
      orderCount: dayOrders.filter((o) => OCCUPYING_STATUSES.includes(o.status)).length,
      over: {
        dough: u.doughG > limits.doughLimitG,
        products: overProducts,
        delivery: u.deliveries > (limits.deliveryEnabled ? limits.deliveryLimit : 0),
      },
    };
  });

  return {
    independentProducts: independent.map((p) => ({ id: p.id, name: p.name })),
    days,
  };
}

function describeWarnings(warnings: DateWarning[]): string {
  return warnings
    .map((w) =>
      w.kind === "HAS_ORDERS"
        ? `HAS_ORDERS ${w.count}`
        : `${w.what}${w.what === "PRODUCT" ? ` ${w.productId}` : ""} limit ${w.limit} < used ${w.used}`,
    )
    .join("; ");
}

function stateOf(day: CalendarDay) {
  return {
    isOpen: day.isOpen,
    doughLimitG: day.overrides.doughLimitG,
    deliveryEnabled: day.limits.deliveryEnabled,
    deliveryLimit: day.overrides.deliveryLimit,
    productLimits: Object.fromEntries(
      Object.entries(day.overrides.productLimits).filter(([, v]) => v !== null),
    ),
    note: day.note,
  };
}

/**
 * PUT /api/admin/dates/{date}. One transaction: ensure the row, lock it (serialises with
 * order transactions), warn, write. Warnings without `confirm` -> 409 OVER_LIMIT and the
 * transaction rolls back (including the row insert). Never touches orders.
 */
export async function updateOpenDate(
  db: DbClient,
  date: LocalDate,
  rawInput: unknown,
  now: Date,
): Promise<CalendarDay> {
  if (!isLocalDate(date)) throw fieldError({ date: "Invalid date (YYYY-MM-DD)" });
  const parsed = dateUpdateSchema.safeParse(rawInput);
  if (!parsed.success) throw fieldError(issuesToFields(parsed.error));
  const input = parsed.data;
  const dbDate = toDbDate(date);

  return db.$transaction(async (tx) => {
    const products = await loadProductMap(tx);
    for (const id of Object.keys(input.productLimits)) {
      if (products[id]?.capacityMode !== "INDEPENDENT") {
        throw fieldError({ [`productLimits.${id}`]: "Not an independent-limit product" });
      }
    }

    const created =
      (await tx.$executeRaw`INSERT INTO "OpenDate" ("date") VALUES (${date}::date) ON CONFLICT ("date") DO NOTHING`) > 0;
    await lockOpenDate(tx, date);

    // Read under the lock: nothing can be added to this day until we commit.
    const current = (await loadCalendar(tx, date, date, { products })).days[0];
    const before = created ? null : stateOf(current);

    const settings = await loadSettings(tx);
    const newOverrides: Record<string, number | null> = { ...current.overrides.productLimits };
    for (const [id, v] of Object.entries(input.productLimits)) newOverrides[id] = v;

    const warnings: DateWarning[] = [];
    const doughLimit = input.doughLimitG ?? settings.defaultDoughLimitG;
    if (current.usage.doughG > doughLimit) {
      warnings.push({ kind: "BELOW_USAGE", what: "DOUGH", limit: doughLimit, used: current.usage.doughG });
    }
    const deliveryLimit = input.deliveryLimit ?? settings.defaultDeliveryLimit;
    if (input.deliveryEnabled && current.usage.deliveries > deliveryLimit) {
      warnings.push({ kind: "BELOW_USAGE", what: "DELIVERY", limit: deliveryLimit, used: current.usage.deliveries });
    }
    for (const p of Object.values(products)) {
      if (p.capacityMode !== "INDEPENDENT") continue;
      const limit = newOverrides[p.id] ?? p.dailyLimit ?? 0;
      const used = current.usage.products[p.id] ?? 0;
      if (used > limit) {
        warnings.push({ kind: "BELOW_USAGE", what: "PRODUCT", productId: p.id, limit, used });
      }
    }
    if (!created && current.isOpen && !input.isOpen && current.orderCount > 0) {
      warnings.push({ kind: "HAS_ORDERS", count: current.orderCount });
    }

    if (warnings.length > 0 && input.confirm !== true) {
      // Throwing rolls back the row insert too: nothing is written.
      throw new AppError("OVER_LIMIT", { message: copy.admin.calendar.overLimitMessage, extra: { warnings } });
    }

    await tx.openDate.update({
      where: { date: dbDate },
      data: {
        isOpen: input.isOpen,
        doughLimitG: input.doughLimitG,
        deliveryEnabled: input.deliveryEnabled,
        deliveryLimit: input.deliveryLimit,
        note: input.note,
      },
    });
    for (const [productId, limit] of Object.entries(input.productLimits)) {
      if (limit === null) {
        await tx.openDateProductLimit.deleteMany({ where: { date: dbDate, productId } });
      } else {
        await tx.openDateProductLimit.upsert({
          where: { date_productId: { date: dbDate, productId } },
          create: { date: dbDate, productId, limit },
          update: { limit },
        });
      }
    }

    const updated = (await loadCalendar(tx, date, date, { products })).days[0];
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "date.update",
      entityType: "OpenDate",
      entityId: date,
      before,
      after: stateOf(updated),
      reason: warnings.length > 0 ? `confirmed warnings: ${describeWarnings(warnings)}` : null,
      at: now,
    });
    return updated;
  });
}
