// Per-day database helpers used inside order transactions (DATA_MODEL.md §4).
// Every function takes the transaction client; none opens its own transaction.

import type { Setting, ProductFlavor } from "@/generated/prisma/client";
import { parseLocalDate } from "@/domain/dates";
import type {
  CartLine,
  CapacityProduct,
  Cents,
  DayLimits,
  DayOrder,
  LocalDate,
  ProductStatus,
} from "@/domain/types";
import type { DbClient, Tx } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";

/** An OpenDate row with `date` as a LocalDate. */
export interface OpenDateRow {
  date: LocalDate;
  isOpen: boolean;
  doughLimitG: number | null;
  deliveryEnabled: boolean;
  deliveryLimit: number | null;
  note: string | null;
}

/**
 * Locks the OpenDate row of `date` (`SELECT … FOR UPDATE`) until the
 * transaction ends. All orders of one pickup date queue up here.
 * Returns null when the date has no row (nothing is locked then).
 *
 * MUST be called with the client of an interactive `prisma.$transaction(async (tx) => …)`
 * running at the default READ COMMITTED isolation. Outside a transaction the lock is
 * released immediately. Under REPEATABLE READ / SERIALIZABLE the snapshot is taken at
 * this statement (before it waits for the lock), so later reads such as loadDayContext
 * would miss the order that was just committed by the previous lock holder -> oversell.
 */
export async function lockOpenDate(tx: Tx, date: LocalDate): Promise<OpenDateRow | null> {
  parseLocalDate(date); // throws on a malformed date before it reaches SQL
  const rows = await tx.$queryRaw<OpenDateRow[]>`
    SELECT to_char("date", 'YYYY-MM-DD') AS "date",
           "isOpen", "doughLimitG", "deliveryEnabled", "deliveryLimit", "note"
    FROM "OpenDate"
    WHERE "date" = ${date}::date
    FOR UPDATE`;
  const row = rows[0];
  return row ? { ...row } : null;
}

/**
 * Locks several dates in ascending order (deadlock avoidance when an edit moves
 * an order between days). Duplicates are locked once. Returns date -> row|null.
 * Same requirement as lockOpenDate: inside an interactive transaction at READ COMMITTED.
 */
export async function lockOpenDates(
  tx: Tx,
  dates: LocalDate[],
): Promise<Map<LocalDate, OpenDateRow | null>> {
  for (const d of dates) parseLocalDate(d);
  // YYYY-MM-DD sorts lexicographically in calendar order.
  const sorted = [...new Set(dates)].sort();
  const result = new Map<LocalDate, OpenDateRow | null>();
  for (const d of sorted) {
    result.set(d, await lockOpenDate(tx, d));
  }
  return result;
}

/** The single Setting row. Throws if it is missing (run the seed). */
export async function loadSettings(tx: Tx): Promise<Setting> {
  const settings = await tx.setting.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("Setting row (id = 1) is missing; run `npm run db:seed`");
  return settings;
}

export interface ProductInfo extends CapacityProduct {
  name: string;
  unitLabel: string;
  status: ProductStatus;
  unitPriceCents: Cents;
  bundleSize: number;
  bundlePriceCents: Cents | null;
  sortOrder: number;
  batchYield: number | null;
  flavors?: ProductFlavor[];
}

export type ProductInfoMap = Record<string, ProductInfo>;

/**
 * ALL products, including PAUSED and ARCHIVED ones: existing orders reference
 * them, and capacity always uses current product settings.
 */
export async function loadProductMap(tx: Tx): Promise<ProductInfoMap> {
  const rows = await tx.product.findMany({ include: { flavors: { orderBy: [{ sort: "asc" }, { id: "asc" }] } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const map: ProductInfoMap = {};
  for (const p of rows) {
    map[p.id] = {
      id: p.id,
      flavors: p.flavors,
      ...(p.saleMode === "GROUP" ? {saleMode:p.saleMode,groupMin:p.groupMin} : {}),
      capacityMode: p.capacityMode,
      doughG: p.doughG,
      roundG: p.roundG,
      piecesPerRound: p.piecesPerRound,
      dailyLimit: p.dailyLimit,
      leadDays: p.leadDays,
      pickupWeekdays: p.pickupWeekdays,
      name: p.name,
      status: p.status,
      unitPriceCents: p.unitPriceCents,
      bundleSize: p.bundleSize,
      bundlePriceCents: p.bundlePriceCents,
      sortOrder: p.sortOrder,
      batchYield: p.batchYield,
      unitLabel: p.unitLabel,
    };
  }
  return map;
}

export interface DayContext {
  /** null when the date has no OpenDate row; limits then fall back to defaults. */
  openDate: OpenDateRow | null;
  limits: DayLimits;
  /** ALL orders of the pickup date (any status), with items. Capacity filters statuses. */
  orders: DayOrder[];
}

/**
 * Everything capacity needs for one pickup date. Call after `lockOpenDate`
 * in the same transaction so the result cannot change underneath.
 */
export async function loadDayContext(
  tx: Tx,
  date: LocalDate,
  settings: Pick<Setting, "defaultDoughLimitG" | "defaultDeliveryLimit">,
  products: Record<string, CapacityProduct>,
): Promise<DayContext> {
  const dbDate = toDbDate(date);
  // Sequential on purpose: one transaction = one connection.
  const openDateRaw = await tx.openDate.findUnique({ where: { date: dbDate } });
  const overrides = await tx.openDateProductLimit.findMany({ where: { date: dbDate } });
  const flavorOverrides = await tx.openDateFlavorLimit.findMany({ where: { date: dbDate } });
  const orders = await tx.order.findMany({
    where: { pickupDate: dbDate },
    select: {
      id: true,
      status: true,
      fulfillment: true,
      items: { select: { productId: true, flavorId: true, stockLotId: true, qty: true }, orderBy: { id: "asc" } },
    },
    orderBy: { seq: "asc" },
  });

  const openDate: OpenDateRow | null = openDateRaw
    ? {
        date: fromDbDate(openDateRaw.date),
        isOpen: openDateRaw.isOpen,
        doughLimitG: openDateRaw.doughLimitG,
        deliveryEnabled: openDateRaw.deliveryEnabled,
        deliveryLimit: openDateRaw.deliveryLimit,
        note: openDateRaw.note,
      }
    : null;

  const overrideByProduct = new Map(overrides.map((o) => [o.productId, o.limit]));
  const productLimits: Record<string, number> = {};
  for (const p of Object.values(products)) {
    if (p.capacityMode !== "INDEPENDENT") continue;
    const limit = overrideByProduct.get(p.id) ?? p.dailyLimit;
    if (limit === null || limit === undefined) {
      throw new Error(`INDEPENDENT product "${p.id}" has no daily limit`);
    }
    productLimits[p.id] = limit;
  }

  const reservations = await loadPoolReservations(tx, date);
  const limits: DayLimits = {
    ...(reservations.length ? {poolReservations:reservations} : {}),
    doughLimitG: openDate?.doughLimitG ?? settings.defaultDoughLimitG,
    deliveryEnabled: openDate?.deliveryEnabled ?? true,
    deliveryLimit: openDate?.deliveryLimit ?? settings.defaultDeliveryLimit,
    productLimits,
    flavorLimits: Object.fromEntries(flavorOverrides.map(o => [o.flavorId, o.limit])),
  };

  return {
    openDate,
    limits,
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      fulfillment: o.fulfillment,
      items: o.items.map((i) => ({ productId: i.productId, flavorId: i.flavorId, ...(i.stockLotId ? {stockLotId:i.stockLotId} : {}), qty: i.qty })),
    })),
  };
}

/** Converted lots reserve spare once, regardless of whether those pieces have sold. */
export async function loadPoolReservations(tx: DbClient | Tx, date: string): Promise<CartLine[]> {
  const lots = await tx.stockLot.findMany({where:{date:toDbDate(date),groupPoolId:{not:null}},include:{items:{where:{order:{status:{in:["NEW","CONTACTED","CONFIRMED","BAKING","READY","COMPLETED"]}}}}}});
  return lots.flatMap(l => {
    const qty = l.closed ? l.items.reduce((n,i)=>n+i.qty,0) : l.qty;
    return qty || l.closed ? [{productId:l.productId,flavorId:l.flavorId,qty,...(l.closed ? {reservationLotId:l.id} : {})}] : [];
  });
}
