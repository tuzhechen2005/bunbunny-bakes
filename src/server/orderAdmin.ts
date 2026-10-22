// Changing existing orders: customer cancel, owner status changes, payment, and edits
// (DATA_MODEL.md §2, §4 "店主改单" / "顾客或店主取消"; CAPACITY_RULES.md §3.3, §6, §8, §9;
// D26, D45, D46, D48, D52).
//
// Every function runs in ONE interactive transaction at READ COMMITTED:
//   1. plain read of the order's pickupDate,
//   2. lock that day's OpenDate row (and the edit's new day, ascending: lockOpenDates),
//   3. lock the Order row (`SELECT … FOR UPDATE`) and re-read it.
// If the pickupDate moved between 1 and 3 (a concurrent date-changing edit committed), the
// whole transaction is rolled back and run once more; a second move -> STALE.
// Admin mutations compare `expectedUpdatedAt` with the locked row (mismatch -> STALE) and
// set updatedAt = max(now, previous updatedAt + 1 ms), so the token always changes.

import { checkDay } from "@/domain/capacity";
import { cutoffAt as computeCutoffAt, leadDaysOf } from "@/domain/cutoff";
import { compareLocalDate, localDateOf } from "@/domain/dates";
import { priceCart } from "@/domain/pricing";
import {
  adminTransition,
  correctStatus,
  correctionReoccupies,
  customerCanCancel,
  entersConfirmed,
  isOccupying,
} from "@/domain/status";
import type { CartLine, Fulfillment, LocalDate, OrderStatus, PriceSnapshot, Violation } from "@/domain/types";
import { copy } from "@/copy";
import { Prisma } from "@/generated/prisma/client";
import type { PaidMethod } from "@/generated/prisma/client";
import type { z } from "zod";
import { writeAudit } from "./audit";
import { loadDayContext, loadProductMap, loadSettings, lockOpenDates, type OpenDateRow } from "./day";
import type { DbClient, Tx } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";
import { AppError } from "./errors";
import {
  adminChangeStatusSchema,
  adminCorrectStatusSchema,
  adminEditOrderSchema,
  adminSetPaymentSchema,
} from "./orderAdminSchemas";
import { issuesToFields } from "./orderSchemas";
import { mergeLines } from "./orders";
import { enqueueNotification } from "./outbox";
import { allocateSeq } from "./seq";

const MESSAGES = {
  cancelCutoffPassed: copy.errors.CUTOFF_PASSED_CANCEL,
  badTransition: copy.errors.STATUS_NOT_ALLOWED,
} as const;

/** Long enough for concurrent edits queueing on one day's lock. */
const TX_OPTIONS = {
  maxWait: 20_000,
  timeout: 20_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

export interface OrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  pickupDate: LocalDate;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paid: boolean;
  paidMethod: PaidMethod | null;
  /** ISO 8601; pass back as `expectedUpdatedAt`. */
  updatedAt: string;
}

export interface CustomerCancelResult {
  status: "CANCELLED";
  alreadyCancelled: boolean;
  /** The CUSTOMER_CANCELLED outbox row to send after commit; null when nothing was enqueued. */
  notificationId: string | null;
}

export interface AdminChangeStatusInput {
  orderId: string;
  to: OrderStatus;
  reason?: string | null;
  expectedUpdatedAt: string;
}

export interface AdminCorrectStatusInput {
  orderId: string;
  to: OrderStatus;
  reason: string;
  override?: boolean;
  expectedUpdatedAt: string;
}

export interface AdminSetPaymentInput {
  orderId: string;
  paid: boolean;
  method?: PaidMethod | null;
  expectedUpdatedAt: string;
}

export interface AdminEditOrderInput {
  orderId: string;
  items?: CartLine[];
  pickupDate?: LocalDate;
  fulfillment?: Fulfillment;
  wechatId?: string;
  /** undefined = unchanged; null / "" = cleared. */
  note?: string | null;
  override?: boolean;
  reason?: string | null;
  expectedUpdatedAt: string;
}

// ---------------------------------------------------------------------------------------
// Helpers

/** Like parseOrThrow, but a malformed orderId is NOT_FOUND (it cannot name an order). */
function parseAdmin<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    if (result.error.issues.some((i) => i.path[0] === "orderId")) throw new AppError("NOT_FOUND");
    throw new AppError("VALIDATION", { extra: { fields: issuesToFields(result.error) } });
  }
  return result.data;
}

/** Thrown inside a transaction when the order's pickupDate changed before its row was locked. */
class DateMovedError extends Error {
  constructor() {
    super("order pickupDate moved while locking");
    this.name = "DateMovedError";
  }
}

/** Runs `fn` in a transaction; retries once if the order moved to another day mid-lock. */
async function runLocked<T>(db: DbClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction((tx) => fn(tx), TX_OPTIONS);
    } catch (e) {
      if (e instanceof DateMovedError) {
        if (attempt === 0) continue;
        throw new AppError("STALE");
      }
      throw e;
    }
  }
}

const orderInclude = { items: { orderBy: { id: "asc" } } } as const satisfies Prisma.OrderInclude;
type LockedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

interface Locked {
  order: LockedOrder;
  date: LocalDate;
  days: Map<LocalDate, OpenDateRow | null>;
}

/**
 * Plain read of the pickupDate -> lock that day (+ `extraDates`, ascending) -> lock the
 * Order row -> re-read it. Throws NOT_FOUND, or DateMovedError for runLocked to retry.
 * `lockDays: false` locks only the Order row (payment: no capacity involved).
 */
async function lockOrder(
  tx: Tx,
  where: { id: string } | { viewToken: string },
  options: { extraDates?: LocalDate[]; lockDays?: boolean } = {},
): Promise<Locked> {
  const head = await tx.order.findUnique({ where, select: { id: true, pickupDate: true } });
  if (!head) throw new AppError("NOT_FOUND");
  const date = fromDbDate(head.pickupDate);
  const days =
    options.lockDays === false
      ? new Map<LocalDate, OpenDateRow | null>()
      : await lockOpenDates(tx, [date, ...(options.extraDates ?? [])]);
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${head.id}::uuid FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: head.id }, include: orderInclude });
  if (!order) throw new AppError("NOT_FOUND");
  if (options.lockDays !== false && fromDbDate(order.pickupDate) !== date) throw new DateMovedError();
  return { order, date: fromDbDate(order.pickupDate), days };
}

/**
 * The new updatedAt for a write to a row last stamped `prev`: max(now, prev + 1 ms).
 * updatedAt is the optimistic-concurrency token, so it must strictly increase even when two
 * writes land in the same millisecond or the clock steps back.
 */
function nextUpdatedAt(prev: Date, now: Date): Date {
  return new Date(Math.max(now.getTime(), prev.getTime() + 1));
}

function assertFresh(order: { updatedAt: Date }, expectedUpdatedAt: string): void {
  if (new Date(expectedUpdatedAt).getTime() !== order.updatedAt.getTime()) {
    throw new AppError("STALE");
  }
}

function summaryOf(o: {
  id: string;
  orderNo: string;
  status: OrderStatus;
  pickupDate: Date;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paid: boolean;
  paidMethod: PaidMethod | null;
  updatedAt: Date;
}): OrderSummary {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    pickupDate: fromDbDate(o.pickupDate),
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    totalCents: o.totalCents,
    paid: o.paid,
    paidMethod: o.paidMethod,
    updatedAt: o.updatedAt.toISOString(),
  };
}

const summarySelect = {
  id: true,
  orderNo: true,
  status: true,
  pickupDate: true,
  subtotalCents: true,
  deliveryFeeCents: true,
  totalCents: true,
  paid: true,
  paidMethod: true,
  updatedAt: true,
} as const satisfies Prisma.OrderSelect;

/** Capacity violations of `candidate` on `date`, not counting this order's current content. */
async function violationsFor(
  tx: Tx,
  orderId: string,
  date: LocalDate,
  candidate: { items: CartLine[]; fulfillment: Fulfillment },
  products?: Awaited<ReturnType<typeof loadProductMap>>,
): Promise<Violation[]> {
  const settings = await loadSettings(tx);
  const productMap = products ?? (await loadProductMap(tx));
  const day = await loadDayContext(tx, date, settings, productMap);
  return checkDay({
    date,
    existing: day.orders,
    candidate,
    excludeOrderId: orderId,
    products: productMap,
    limits: day.limits,
  }).violations;
}

async function auditOverride(tx: Tx, orderId: string, violations: Violation[], reason: string | null, now: Date) {
  await writeAudit(tx, {
    actor: "ADMIN",
    action: "order.override",
    entityType: "Order",
    entityId: orderId,
    after: { violations },
    reason,
    at: now,
  });
}

// ---------------------------------------------------------------------------------------
// Customer cancel (POST /api/o/{token}/cancel; CAPACITY_RULES §9, D26)

export async function customerCancel(
  db: DbClient,
  input: { viewToken: string },
  now: Date,
): Promise<CustomerCancelResult> {
  const viewToken = typeof input?.viewToken === "string" ? input.viewToken : "";
  if (!viewToken) throw new AppError("NOT_FOUND");

  return runLocked(db, async (tx) => {
    const { order } = await lockOrder(tx, { viewToken });
    if (order.status === "CANCELLED") {
      return { status: "CANCELLED", alreadyCancelled: true, notificationId: null };
    }
    if (!customerCanCancel(order.status, now, order.cutoffAt)) {
      const beforeCutoffStatus = ["NEW", "CONTACTED", "CONFIRMED"].includes(order.status);
      if (beforeCutoffStatus) {
        throw new AppError("CUTOFF_PASSED", { message: MESSAGES.cancelCutoffPassed });
      }
      throw new AppError("NOT_CANCELLABLE");
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "CUSTOMER", updatedAt: nextUpdatedAt(order.updatedAt, now) },
    });
    await writeAudit(tx, {
      actor: "CUSTOMER",
      action: "order.cancel",
      entityType: "Order",
      entityId: order.id,
      before: { status: order.status },
      after: { status: "CANCELLED" },
      at: now,
    });
    const notification = await enqueueNotification(tx, {
      kind: "CUSTOMER_CANCELLED",
      dedupeKey: `customer_cancelled:${order.id}`,
      payload: { orderId: order.id },
      now,
    });
    return {
      status: "CANCELLED",
      alreadyCancelled: false,
      notificationId: notification.created ? notification.id : null,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Admin status change (POST /api/admin/orders/{id}/status; D46)

export async function adminChangeStatus(
  db: DbClient,
  input: AdminChangeStatusInput,
  now: Date,
): Promise<OrderSummary> {
  const data = parseAdmin(adminChangeStatusSchema, input);

  return runLocked(db, async (tx) => {
    const { order } = await lockOrder(tx, { id: data.orderId });
    assertFresh(order, data.expectedUpdatedAt);

    const check = adminTransition(order.status, data.to);
    if (!check.ok) {
      throw new AppError("VALIDATION", { message: MESSAGES.badTransition, extra: { fields: { to: MESSAGES.badTransition } } });
    }
    if (check.reasonRequired && !data.reason) {
      throw new AppError("VALIDATION", { extra: { fields: { reason: "Required" } } });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: data.to,
        updatedAt: nextUpdatedAt(order.updatedAt, now),
        ...(entersConfirmed(order.status, data.to) && order.confirmedAt === null ? { confirmedAt: now } : {}),
        ...(data.to === "CANCELLED" ? { cancelledAt: now, cancelledBy: "ADMIN" as const } : {}),
      },
      select: summarySelect,
    });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "order.status",
      entityType: "Order",
      entityId: order.id,
      before: { status: order.status },
      after: { status: data.to },
      reason: data.reason,
      at: now,
    });
    return summaryOf(updated);
  });
}

// ---------------------------------------------------------------------------------------
// Admin status correction (POST /api/admin/orders/{id}/correct-status; D46)

const CONFIRMED_OR_LATER: readonly OrderStatus[] = ["CONFIRMED", "BAKING", "READY", "COMPLETED"];

export async function adminCorrectStatus(
  db: DbClient,
  input: AdminCorrectStatusInput,
  now: Date,
): Promise<OrderSummary> {
  const data = parseAdmin(adminCorrectStatusSchema, input);

  return runLocked(db, async (tx) => {
    const { order, date } = await lockOrder(tx, { id: data.orderId });
    assertFresh(order, data.expectedUpdatedAt);

    if (!correctStatus(order.status, data.to).ok) {
      throw new AppError("VALIDATION", { message: MESSAGES.badTransition, extra: { fields: { to: MESSAGES.badTransition } } });
    }

    let violations: Violation[] = [];
    if (correctionReoccupies(order.status, data.to)) {
      violations = await violationsFor(tx, order.id, date, {
        items: order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
        fulfillment: order.fulfillment,
      });
      if (violations.length > 0 && !data.override) {
        throw new AppError("OVER_LIMIT", { extra: { violations } });
      }
    }

    const data2: Prisma.OrderUpdateInput = { status: data.to, updatedAt: nextUpdatedAt(order.updatedAt, now) };
    if (CONFIRMED_OR_LATER.includes(data.to) && order.confirmedAt === null) data2.confirmedAt = now;
    if (order.status === "CANCELLED") {
      data2.cancelledAt = null;
      data2.cancelledBy = null;
    }
    if (data.to === "CANCELLED") {
      data2.cancelledAt = now;
      data2.cancelledBy = "ADMIN";
    }

    const updated = await tx.order.update({ where: { id: order.id }, data: data2, select: summarySelect });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "order.status_correct",
      entityType: "Order",
      entityId: order.id,
      before: { status: order.status },
      after: { status: data.to },
      reason: data.reason,
      at: now,
    });
    if (violations.length > 0) await auditOverride(tx, order.id, violations, data.reason, now);
    return summaryOf(updated);
  });
}

// ---------------------------------------------------------------------------------------
// Payment (POST /api/admin/orders/{id}/payment)

export async function adminSetPayment(
  db: DbClient,
  input: AdminSetPaymentInput,
  now: Date,
): Promise<OrderSummary> {
  const data = parseAdmin(adminSetPaymentSchema, input);

  return runLocked(db, async (tx) => {
    const { order } = await lockOrder(tx, { id: data.orderId }, { lockDays: false });
    assertFresh(order, data.expectedUpdatedAt);

    const next = data.paid
      ? {
          paid: true,
          paidAt: order.paid && order.paidAt ? order.paidAt : now,
          paidMethod: data.method ?? order.paidMethod ?? null,
        }
      : { paid: false, paidAt: null, paidMethod: null };

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { ...next, updatedAt: nextUpdatedAt(order.updatedAt, now) },
      select: summarySelect,
    });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "order.paid",
      entityType: "Order",
      entityId: order.id,
      before: { paid: order.paid, paidMethod: order.paidMethod, paidAt: order.paidAt },
      after: next,
      at: now,
    });
    return summaryOf(updated);
  });
}

// ---------------------------------------------------------------------------------------
// Edit (PATCH /api/admin/orders/{id}; DATA_MODEL §4 "店主改单", CAPACITY_RULES §3.3, §6, §8)

function sameCart(a: CartLine[], b: CartLine[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: CartLine[]) =>
    [...l]
      .sort((x, y) => (x.productId < y.productId ? -1 : x.productId > y.productId ? 1 : 0))
      .map((x) => `${x.productId}:${x.qty}`)
      .join(",");
  return key(a) === key(b);
}

export async function adminEditOrder(
  db: DbClient,
  input: AdminEditOrderInput,
  now: Date,
): Promise<OrderSummary> {
  const data = parseAdmin(adminEditOrderSchema, input);

  return runLocked(db, async (tx) => {
    const { order, date: oldDate, days } = await lockOrder(tx, { id: data.orderId }, {
      extraDates: data.pickupDate ? [data.pickupDate] : [],
    });
    assertFresh(order, data.expectedUpdatedAt);

    // --- new content
    const oldCart: CartLine[] = mergeLines(order.items.map((i) => ({ productId: i.productId, qty: i.qty })));
    const newDate = data.pickupDate ?? oldDate;
    const dateChanged = newDate !== oldDate;
    const newCart = data.items ? mergeLines(data.items) : oldCart;
    const itemsChanged = !sameCart(oldCart, newCart);
    const newFulfillment = data.fulfillment ?? order.fulfillment;
    const fulfillmentChanged = newFulfillment !== order.fulfillment;
    const newWechatId = data.wechatId ?? order.wechatId;
    const newNote = data.note === undefined ? order.note : data.note;

    // --- the new date (owner: cutoff and the ordering switch do not apply; past days do)
    if (dateChanged) {
      const row = days.get(newDate);
      if (!row || !row.isOpen || compareLocalDate(newDate, localDateOf(now)) < 0) {
        throw new AppError("DATE_CLOSED");
      }
    }

    // --- products: new ones must exist and not be ARCHIVED (PAUSED is fine for the owner)
    const settings = await loadSettings(tx);
    const products = await loadProductMap(tx);
    const existingByProduct = new Map(order.items.map((i) => [i.productId, i]));
    const unavailable = newCart.filter(
      (l) =>
        !existingByProduct.has(l.productId) &&
        (!Object.prototype.hasOwnProperty.call(products, l.productId) ||
          products[l.productId].status === "ARCHIVED"),
    );
    if (unavailable.length) {
      throw new AppError("PRODUCT_UNAVAILABLE", { extra: { productIds: unavailable.map((l) => l.productId) } });
    }

    // --- capacity (only content changes can change usage)
    let violations: Violation[] = [];
    if (isOccupying(order.status) && (itemsChanged || dateChanged || fulfillmentChanged)) {
      violations = await violationsFor(
        tx,
        order.id,
        newDate,
        { items: newCart, fulfillment: newFulfillment },
        products,
      );
      if (violations.length > 0 && !data.override) {
        throw new AppError("OVER_LIMIT", { extra: { violations } });
      }
    }

    // --- prices: snapshots for products already on the order (D45), current for new ones
    const lines = newCart.map((l) => {
      const existing = existingByProduct.get(l.productId);
      const price: PriceSnapshot = existing
        ? {
            unitPriceCents: existing.unitPriceCents,
            bundleSize: existing.bundleSize,
            bundlePriceCents: existing.bundlePriceCents,
          }
        : {
            unitPriceCents: products[l.productId].unitPriceCents,
            bundleSize: products[l.productId].bundleSize,
            bundlePriceCents: products[l.productId].bundlePriceCents,
          };
      const name = existing ? existing.nameSnapshot : products[l.productId].name;
      return { productId: l.productId, qty: l.qty, price, name };
    });
    const repriced = itemsChanged || fulfillmentChanged;
    const pricing = priceCart(lines, newFulfillment, {
      deliveryFeeCents: settings.deliveryFeeCents,
      freeDeliveryMinCents: settings.freeDeliveryMinCents,
    });
    const totals = repriced
      ? {
          subtotalCents: pricing.subtotalCents,
          deliveryFeeCents: pricing.deliveryFeeCents,
          totalCents: pricing.totalCents,
        }
      : {
          subtotalCents: order.subtotalCents,
          deliveryFeeCents: order.deliveryFeeCents,
          totalCents: order.totalCents,
        };

    // --- cutoff (CAPACITY_RULES §6: recomputed on owner edits)
    const newCutoffAt =
      itemsChanged || dateChanged
        ? computeCutoffAt(newDate, leadDaysOf(newCart, products), settings.cutoffTime)
        : order.cutoffAt;

    // --- D52: a new number on the new date (both days are locked); viewToken never changes
    const numbering = dateChanged ? await allocateSeq(tx, newDate) : { seq: order.seq, orderNo: order.orderNo };

    // --- writes
    if (itemsChanged) {
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.orderItem.createMany({
        data: lines.map((l, i) => ({
          orderId: order.id,
          productId: l.productId,
          nameSnapshot: l.name,
          qty: l.qty,
          unitPriceCents: l.price.unitPriceCents,
          bundleSize: l.price.bundleSize,
          bundlePriceCents: l.price.bundlePriceCents,
          lineTotalCents: pricing.lines[i].lineTotalCents,
        })),
      });
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        pickupDate: toDbDate(newDate),
        seq: numbering.seq,
        orderNo: numbering.orderNo,
        fulfillment: newFulfillment,
        wechatId: newWechatId,
        note: newNote,
        cutoffAt: newCutoffAt,
        ...totals,
        updatedAt: nextUpdatedAt(order.updatedAt, now),
      },
      select: summarySelect,
    });

    await writeAudit(tx, {
      actor: "ADMIN",
      action: "order.edit",
      entityType: "Order",
      entityId: order.id,
      before: {
        orderNo: order.orderNo,
        pickupDate: oldDate,
        fulfillment: order.fulfillment,
        wechatId: order.wechatId,
        note: order.note,
        items: order.items.map((i) => ({
          productId: i.productId,
          name: i.nameSnapshot,
          qty: i.qty,
          lineTotalCents: i.lineTotalCents,
        })),
        subtotalCents: order.subtotalCents,
        deliveryFeeCents: order.deliveryFeeCents,
        totalCents: order.totalCents,
        cutoffAt: order.cutoffAt,
      },
      after: {
        orderNo: numbering.orderNo,
        pickupDate: newDate,
        fulfillment: newFulfillment,
        wechatId: newWechatId,
        note: newNote,
        items: lines.map((l, i) => ({
          productId: l.productId,
          name: l.name,
          qty: l.qty,
          lineTotalCents: pricing.lines[i].lineTotalCents,
        })),
        ...totals,
        cutoffAt: newCutoffAt,
      },
      reason: data.reason,
      at: now,
    });
    if (violations.length > 0) await auditOverride(tx, order.id, violations, data.reason, now);
    return summaryOf(updated);
  });
}
