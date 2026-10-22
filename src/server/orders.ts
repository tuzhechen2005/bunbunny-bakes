// Order creation transactions (DATA_MODEL.md §4; CAPACITY_RULES.md §6–§8; D37, D38).
//
// Every create runs in ONE interactive transaction at READ COMMITTED that first locks the
// pickup date's OpenDate row (`SELECT … FOR UPDATE`). All creates for one day queue on that
// lock, so the capacity check and the insert can never interleave with another create.

import { suggestNextDate } from "@/domain/availability";
import { checkDay } from "@/domain/capacity";
import { cutoffAt as computeCutoffAt, isBeforeCutoff, leadDaysOf } from "@/domain/cutoff";
import { compareLocalDate, localDateOf } from "@/domain/dates";
import { priceCart } from "@/domain/pricing";
import type { CartLine, Fulfillment, LocalDate, Violation } from "@/domain/types";
import { copy } from "@/copy";
import { Prisma } from "@/generated/prisma/client";
import type { Setting } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import { loadAvailabilityInput } from "./availabilityData";
import {
  loadDayContext,
  loadProductMap,
  loadSettings,
  lockOpenDate,
  type ProductInfoMap,
} from "./day";
import type { DbClient, Tx } from "./db";
import { toDbDate } from "./dbDates";
import { AppError, isAppError } from "./errors";
import { adminOrderSchema, customerOrderSchema, parseOrThrow } from "./orderSchemas";
import { enqueueNotification } from "./outbox";
import { allocateSeq } from "./seq";
import { newViewToken } from "./tokens";

export interface CreateOrderInput {
  items: CartLine[];
  pickupDate: LocalDate;
  fulfillment: Fulfillment;
  wechatId: string;
  note?: string | null;
  idempotencyKey?: string | null;
  /** sha256(ip + secret) computed by the route (src/server/tokens.ts hashIp); null skips the IP limit. */
  ipHash?: string | null;
}

export interface CreatedOrder {
  id: string;
  orderNo: string;
  viewToken: string;
  /** The NEW_ORDER outbox row to send after commit; null for admin orders and replays. */
  notificationId: string | null;
  /** true when an existing order was returned for a repeated idempotencyKey (HTTP 200). */
  replayed: boolean;
}

export interface AdminCreateInput extends Omit<CreateOrderInput, "idempotencyKey" | "ipHash"> {
  override?: boolean;
  reason?: string | null;
}

/** Long enough for 20-way contention on one day's lock. */
const TX_OPTIONS = { maxWait: 20_000, timeout: 20_000 } as const;

/** D38: at most 3 orders per IP per rolling hour. */
const IP_LIMIT_PER_HOUR = 3;
/** D38: at most 2 unconfirmed (NEW / CONTACTED) orders per WeChat id per pickup date. */
const WECHAT_UNCONFIRMED_LIMIT = 2;
const HOUR_MS = 60 * 60 * 1000;

/** Sums qty per product, keeping first-seen order. */
export function mergeLines(lines: CartLine[]): CartLine[] {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.qty);
  return [...totals].map(([productId, qty]) => ({ productId, qty }));
}

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/** Cutoff of the merged cart for the pickup date (stored on the order). */
function cartCutoff(cart: CartLine[], date: LocalDate, products: ProductInfoMap, settings: Setting): Date {
  return computeCutoffAt(date, leadDaysOf(cart, products), settings.cutoffTime);
}

interface InsertInput {
  date: LocalDate;
  cart: CartLine[];
  fulfillment: Fulfillment;
  wechatId: string;
  note: string | null;
  products: ProductInfoMap;
  settings: Setting;
  cutoffAt: Date;
  now: Date;
  source: "WEB" | "ADMIN";
  idempotencyKey: string | null;
  ipHash: string | null;
}

/** Prices from CURRENT product prices (snapshotted), allocates seq, inserts Order + items + audit. */
async function insertOrder(tx: Tx, input: InsertInput) {
  const { date, cart, fulfillment, products, settings, now, source } = input;
  const lines = cart.map((l) => {
    const p = products[l.productId];
    return {
      productId: l.productId,
      qty: l.qty,
      name: p.name,
      price: {
        unitPriceCents: p.unitPriceCents,
        bundleSize: p.bundleSize,
        bundlePriceCents: p.bundlePriceCents,
      },
    };
  });
  const pricing = priceCart(lines, fulfillment, {
    deliveryFeeCents: settings.deliveryFeeCents,
    freeDeliveryMinCents: settings.freeDeliveryMinCents,
  });

  const { seq, orderNo } = await allocateSeq(tx, date);
  const viewToken = newViewToken();
  const isAdmin = source === "ADMIN";

  const order = await tx.order.create({
    data: {
      pickupDate: toDbDate(date),
      seq,
      orderNo,
      viewToken,
      wechatId: input.wechatId,
      fulfillment,
      status: isAdmin ? "CONFIRMED" : "NEW",
      confirmedAt: isAdmin ? now : null,
      subtotalCents: pricing.subtotalCents,
      deliveryFeeCents: pricing.deliveryFeeCents,
      totalCents: pricing.totalCents,
      note: input.note,
      cutoffAt: input.cutoffAt,
      source,
      idempotencyKey: input.idempotencyKey,
      ipHash: input.ipHash,
      createdAt: now,
      updatedAt: now,
      items: {
        create: lines.map((l, i) => ({
          productId: l.productId,
          nameSnapshot: l.name,
          qty: l.qty,
          unitPriceCents: l.price.unitPriceCents,
          bundleSize: l.price.bundleSize,
          bundlePriceCents: l.price.bundlePriceCents,
          lineTotalCents: pricing.lines[i].lineTotalCents,
        })),
      },
    },
    select: { id: true, orderNo: true, viewToken: true, status: true },
  });

  await writeAudit(tx, {
    actor: isAdmin ? "ADMIN" : "CUSTOMER",
    action: "order.create",
    entityType: "Order",
    entityId: order.id,
    after: {
      orderNo,
      pickupDate: date,
      status: order.status,
      source,
      fulfillment,
      wechatId: input.wechatId,
      note: input.note,
      items: lines.map((l, i) => ({
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        lineTotalCents: pricing.lines[i].lineTotalCents,
      })),
      subtotalCents: pricing.subtotalCents,
      deliveryFeeCents: pricing.deliveryFeeCents,
      totalCents: pricing.totalCents,
      cutoffAt: input.cutoffAt,
    },
    at: now,
  });

  return order;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function findByIdempotencyKey(client: DbClient | Tx, key: string): Promise<CreatedOrder | null> {
  const existing = await client.order.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, orderNo: true, viewToken: true },
  });
  return existing ? { ...existing, notificationId: null, replayed: true } : null;
}

/** First DOUGH/PRODUCT violation -> FULL; DELIVERY/DELIVERY_DISABLED -> DELIVERY_FULL. */
function capacityError(violations: Violation[]): AppError | null {
  if (violations.some((v) => v.kind === "DOUGH" || v.kind === "PRODUCT")) return new AppError("FULL");
  if (violations.length > 0) return new AppError("DELIVERY_FULL");
  return null;
}

/**
 * Customer order (POST /api/orders). Throws AppError with API_SPEC §1 codes.
 * `now` is supplied by the caller (route: `new Date()`).
 */
export async function createCustomerOrder(
  db: DbClient,
  input: CreateOrderInput,
  now: Date,
): Promise<CreatedOrder> {
  const { ipHash: rawIpHash, ...rest } = input;
  const data = parseOrThrow(customerOrderSchema, rest);
  const ipHash = rawIpHash ?? null;
  const date = data.pickupDate;
  const cart = mergeLines(data.items);
  const key = data.idempotencyKey;

  try {
    return await db.$transaction(async (tx) => {
      // 1. Lock the day. Everything below sees the committed state of earlier creates.
      const openDate = await lockOpenDate(tx, date);

      // 2. Idempotent replay: no new writes.
      if (key) {
        const existing = await findByIdempotencyKey(tx, key);
        if (existing) return existing;
      }

      // 3. Ordering switch.
      const settings = await loadSettings(tx);
      if (!settings.orderingEnabled) throw new AppError("ORDERING_DISABLED");

      // 4. Date: must exist, be open, and be after today (Chicago).
      if (!openDate || !openDate.isOpen || compareLocalDate(date, localDateOf(now)) <= 0) {
        throw new AppError("DATE_CLOSED");
      }

      // 5. Products and the per-item max (on merged quantities).
      const products = await loadProductMap(tx);
      const unavailable = cart.filter(
        (l) => !has(products, l.productId) || products[l.productId].status !== "ACTIVE",
      );
      if (unavailable.length) {
        throw new AppError("PRODUCT_UNAVAILABLE", {
          extra: { productIds: unavailable.map((l) => l.productId) },
        });
      }
      const overMax = cart.filter((l) => l.qty > settings.maxQtyPerItem);
      if (overMax.length) {
        throw new AppError("QTY_LIMIT", { extra: { productIds: overMax.map((l) => l.productId) } });
      }

      // 6. Cutoff: now < cutoff, strictly.
      const cutoffAt = cartCutoff(cart, date, products, settings);
      if (!isBeforeCutoff(now, cutoffAt)) throw new AppError("CUTOFF_PASSED");

      // 7. Rate limits (D38).
      if (ipHash) {
        const rlKey = `order_ip:${ipHash}`;
        // Serialize orders from one IP across dates (the day lock alone does not).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rlKey}, 0))`;
        const hits = await tx.rateLimitHit.count({
          where: { key: rlKey, at: { gt: new Date(now.getTime() - HOUR_MS) } },
        });
        if (hits >= IP_LIMIT_PER_HOUR) throw new AppError("RATE_LIMITED");
      }
      const unconfirmed = await tx.order.count({
        where: {
          wechatId: data.wechatId,
          pickupDate: toDbDate(date),
          status: { in: ["NEW", "CONTACTED"] },
        },
      });
      if (unconfirmed >= WECHAT_UNCONFIRMED_LIMIT) throw new AppError("RATE_LIMITED");

      // 8. Capacity: recompute the whole day with the candidate merged in.
      const day = await loadDayContext(tx, date, settings, products);
      const check = checkDay({
        date,
        existing: day.orders,
        candidate: { items: cart, fulfillment: data.fulfillment },
        products,
        limits: day.limits,
      });
      const capErr = capacityError(check.violations);
      if (capErr) throw capErr;

      // 9. Writes.
      const order = await insertOrder(tx, {
        date,
        cart,
        fulfillment: data.fulfillment,
        wechatId: data.wechatId,
        note: data.note,
        products,
        settings,
        cutoffAt,
        now,
        source: "WEB",
        idempotencyKey: key,
        ipHash,
      });
      if (ipHash) {
        await tx.rateLimitHit.create({ data: { key: `order_ip:${ipHash}`, at: now } });
      }
      const notification = await enqueueNotification(tx, {
        kind: "NEW_ORDER",
        dedupeKey: `new_order:${order.id}`,
        payload: { orderId: order.id },
        now,
      });

      return {
        id: order.id,
        orderNo: order.orderNo,
        viewToken: order.viewToken,
        notificationId: notification.created ? notification.id : null,
        replayed: false,
      };
    }, TX_OPTIONS);
  } catch (e) {
    if (isAppError(e) && e.code === "FULL") {
      // Display only, computed after the rollback without locks (DATA_MODEL §4 step 6).
      const avail = await loadAvailabilityInput(db, { cart, fulfillment: data.fulfillment, now });
      const suggestion = suggestNextDate(avail, date);
      throw new AppError("FULL", {
        message: suggestion ? copy.errors.FULL : copy.errors.FULL_NO_SUGGESTION,
        extra: { suggestion },
      });
    }
    // The same key raced in on another pickup date (different day lock): return that order.
    if (key && isUniqueViolation(e)) {
      const existing = await findByIdempotencyKey(db, key);
      if (existing) return existing;
    }
    throw e;
  }
}

/**
 * Phone order entered by the owner (POST /api/admin/orders; CAPACITY_RULES §8).
 * No ordering switch, cutoff, per-item max, rate limit or idempotency. Starts CONFIRMED.
 * Capacity violations -> OVER_LIMIT with `extra.violations`, unless override + reason.
 */
export async function createAdminOrder(
  db: DbClient,
  input: AdminCreateInput,
  now: Date,
): Promise<CreatedOrder> {
  const data = parseOrThrow(adminOrderSchema, input);
  const date = data.pickupDate;
  const cart = mergeLines(data.items);

  return db.$transaction(async (tx) => {
    const openDate = await lockOpenDate(tx, date);
    // Same-day phone orders are allowed; past dates are not.
    if (!openDate || !openDate.isOpen || compareLocalDate(date, localDateOf(now)) < 0) {
      throw new AppError("DATE_CLOSED");
    }

    const settings = await loadSettings(tx);
    const products = await loadProductMap(tx);
    const unavailable = cart.filter(
      (l) => !has(products, l.productId) || products[l.productId].status === "ARCHIVED",
    );
    if (unavailable.length) {
      throw new AppError("PRODUCT_UNAVAILABLE", {
        extra: { productIds: unavailable.map((l) => l.productId) },
      });
    }

    const day = await loadDayContext(tx, date, settings, products);
    const { violations } = checkDay({
      date,
      existing: day.orders,
      candidate: { items: cart, fulfillment: data.fulfillment },
      products,
      limits: day.limits,
    });
    const overridden = violations.length > 0;
    if (overridden && !data.override) {
      throw new AppError("OVER_LIMIT", { extra: { violations } });
    }

    // Stored for reference; the owner is never bound by it.
    const cutoffAt = cartCutoff(cart, date, products, settings);
    const order = await insertOrder(tx, {
      date,
      cart,
      fulfillment: data.fulfillment,
      wechatId: data.wechatId,
      note: data.note,
      products,
      settings,
      cutoffAt,
      now,
      source: "ADMIN",
      idempotencyKey: null,
      ipHash: null,
    });
    if (overridden) {
      await writeAudit(tx, {
        actor: "ADMIN",
        action: "order.override",
        entityType: "Order",
        entityId: order.id,
        after: { violations },
        reason: data.reason,
        at: now,
      });
    }
    return {
      id: order.id,
      orderNo: order.orderNo,
      viewToken: order.viewToken,
      notificationId: null,
      replayed: false,
    };
  }, TX_OPTIONS);
}
