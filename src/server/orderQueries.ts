// Read side of the admin order API: the list (filters, search, cursor paging) and the
// detail view with its audit log (API_SPEC.md §3, PAGES.md /admin/orders). Business
// writes live in orders.ts / orderAdmin.ts.

import { z } from "zod";
import { dayLabel, isLocalDate, localDateOf } from "@/domain/dates";
import { adminTransition } from "@/domain/status";
import type { Fulfillment, LocalDate, OrderStatus } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import type { PaidMethod } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";
import { AppError } from "./errors";
import { ORDER_STATUSES } from "./orderAdminSchemas";

export const ORDERS_PAGE_SIZE = 50;

/** A status an admin may move to with the normal flow (D46). */
export interface NextStatus {
  to: OrderStatus;
  reasonRequired: boolean;
}

function rank(s: OrderStatus): number {
  // Forward chain first, then 拒绝, then 取消.
  if (s === "REJECTED") return 101;
  if (s === "CANCELLED") return 102;
  return ORDER_STATUSES.indexOf(s);
}

export function nextStatusesOf(from: OrderStatus): NextStatus[] {
  const out: NextStatus[] = [];
  for (const to of ORDER_STATUSES) {
    const check = adminTransition(from, to);
    if (check.ok) out.push({ to, reasonRequired: check.reasonRequired });
  }
  return out.sort((a, b) => rank(a.to) - rank(b.to));
}

// ---------------------------------------------------------------------------------------
// List

const localDate = z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" });
const statusEnum = z.enum(ORDER_STATUSES);

export const listOrdersQuerySchema = z.object({
  date: localDate.optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  status: z
    .union([statusEnum, z.array(statusEnum)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  fulfillment: z.enum(["PICKUP", "DELIVERY"]).optional(),
  paid: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  productId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(60).optional(),
});
export type ListOrdersQuery = z.output<typeof listOrdersQuerySchema>;

export interface OrderRow {
  id: string;
  orderNo: string;
  wechatId: string;
  itemsSummary: string;
  totalCents: number;
  fulfillment: Fulfillment;
  pickupDate: LocalDate;
  pickupDateLabel: string;
  status: OrderStatus;
  paid: boolean;
  /** ISO 8601; send back as `expectedUpdatedAt`. */
  updatedAt: string;
  nextStatuses: NextStatus[];
}

export interface OrderList {
  orders: OrderRow[];
  nextCursor: string | null;
  /** The shop's calendar day, for the "明天" quick filter. */
  today: LocalDate;
  /** For the product filter: every non-archived product, in menu order. */
  products: { id: string; name: string }[];
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}):(\d{1,9})$/;

function parseCursor(cursor: string): { date: LocalDate; seq: number } {
  const m = CURSOR_RE.exec(cursor);
  if (!m || !isLocalDate(m[1])) {
    throw new AppError("VALIDATION", { extra: { fields: { cursor: "Invalid cursor" } } });
  }
  return { date: m[1], seq: Number(m[2]) };
}

const itemOrder: Prisma.OrderItemOrderByWithRelationInput[] = [
  { product: { sortOrder: "asc" } },
  { nameSnapshot: "asc" },
];

export async function listOrders(db: DbClient, query: ListOrdersQuery, now: Date): Promise<OrderList> {
  const today = localDateOf(now);
  const and: Prisma.OrderWhereInput[] = [];

  if (query.date) {
    and.push({ pickupDate: toDbDate(query.date) });
  } else if (query.from || query.to) {
    and.push({
      pickupDate: {
        ...(query.from ? { gte: toDbDate(query.from) } : {}),
        ...(query.to ? { lte: toDbDate(query.to) } : {}),
      },
    });
  } else {
    and.push({ pickupDate: { gte: toDbDate(today) } });
  }
  if (query.status?.length) and.push({ status: { in: query.status } });
  if (query.fulfillment) and.push({ fulfillment: query.fulfillment });
  if (query.paid !== undefined) and.push({ paid: query.paid });
  if (query.productId) and.push({ items: { some: { productId: query.productId } } });
  if (query.q) {
    and.push({
      OR: [
        { orderNo: { contains: query.q, mode: "insensitive" } },
        { wechatId: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  if (query.cursor) {
    const c = parseCursor(query.cursor);
    and.push({
      OR: [
        { pickupDate: { gt: toDbDate(c.date) } },
        { pickupDate: toDbDate(c.date), seq: { gt: c.seq } },
      ],
    });
  }

  const [rows, products] = await Promise.all([
    db.order.findMany({
      where: { AND: and },
      orderBy: [{ pickupDate: "asc" }, { seq: "asc" }],
      take: ORDERS_PAGE_SIZE + 1,
      include: { items: { orderBy: itemOrder } },
    }),
    db.product.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const page = rows.slice(0, ORDERS_PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > ORDERS_PAGE_SIZE && last ? `${fromDbDate(last.pickupDate)}:${last.seq}` : null;

  return {
    orders: page.map((o) => {
      const pickupDate = fromDbDate(o.pickupDate);
      return {
        id: o.id,
        orderNo: o.orderNo,
        wechatId: o.wechatId,
        itemsSummary: itemsSummary(o.items),
        totalCents: o.totalCents,
        fulfillment: o.fulfillment,
        pickupDate,
        pickupDateLabel: dayLabel(pickupDate),
        status: o.status,
        paid: o.paid,
        updatedAt: o.updatedAt.toISOString(),
        nextStatuses: nextStatusesOf(o.status),
      };
    }),
    nextCursor,
    today,
    products,
  };
}

/** 「红豆包×4、奶酪角×4」 from the snapshots. */
export function itemsSummary(items: { nameSnapshot: string; qty: number }[]): string {
  return items.map((i) => `${i.nameSnapshot}×${i.qty}`).join("、");
}

// ---------------------------------------------------------------------------------------
// Detail

export interface OrderDetailItem {
  id: string;
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  lineTotalCents: number;
}

export interface OrderLogEntry {
  id: string;
  at: string;
  actor: "ADMIN" | "CUSTOMER" | "SYSTEM";
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
}

export interface OrderDetail {
  id: string;
  orderNo: string;
  wechatId: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  pickupDate: LocalDate;
  pickupDateLabel: string;
  items: OrderDetailItem[];
  itemsSummary: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  note: string | null;
  cutoffAt: string;
  source: "WEB" | "ADMIN";
  paid: boolean;
  paidMethod: PaidMethod | null;
  paidAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: "CUSTOMER" | "ADMIN" | null;
  updatedAt: string;
  viewUrl: string;
  nextStatuses: NextStatus[];
  logs: OrderLogEntry[];
}

/** SITE_URL + "/o/" + token (no double slash). */
export function viewUrlOf(viewToken: string, siteUrl: string | undefined = process.env.SITE_URL): string {
  return `${(siteUrl ?? "").replace(/\/+$/, "")}/o/${viewToken}`;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getOrderDetail(db: DbClient, id: string): Promise<OrderDetail> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const order = await db.order.findUnique({
    where: { id },
    include: { items: { orderBy: itemOrder } },
  });
  if (!order) throw new AppError("NOT_FOUND");
  const logs = await db.auditLog.findMany({
    where: { entityType: "Order", entityId: id },
    orderBy: [{ at: "desc" }, { id: "desc" }],
  });
  const pickupDate = fromDbDate(order.pickupDate);
  return {
    id: order.id,
    orderNo: order.orderNo,
    wechatId: order.wechatId,
    status: order.status,
    fulfillment: order.fulfillment,
    pickupDate,
    pickupDateLabel: dayLabel(pickupDate),
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.nameSnapshot,
      qty: i.qty,
      unitPriceCents: i.unitPriceCents,
      bundleSize: i.bundleSize,
      bundlePriceCents: i.bundlePriceCents,
      lineTotalCents: i.lineTotalCents,
    })),
    itemsSummary: itemsSummary(order.items),
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    note: order.note,
    cutoffAt: order.cutoffAt.toISOString(),
    source: order.source,
    paid: order.paid,
    paidMethod: order.paidMethod,
    paidAt: iso(order.paidAt),
    createdAt: order.createdAt.toISOString(),
    confirmedAt: iso(order.confirmedAt),
    cancelledAt: iso(order.cancelledAt),
    cancelledBy: order.cancelledBy,
    updatedAt: order.updatedAt.toISOString(),
    viewUrl: viewUrlOf(order.viewToken),
    nextStatuses: nextStatusesOf(order.status),
    logs: logs.map((l) => ({
      id: l.id,
      at: l.at.toISOString(),
      actor: l.actor,
      action: l.action,
      before: l.before,
      after: l.after,
      reason: l.reason,
    })),
  };
}
