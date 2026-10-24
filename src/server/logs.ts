// Audit log listing (API_SPEC GET /api/admin/logs): newest first, cursor pagination.

import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { SHOP_TZ, addDays, isLocalDate } from "@/domain/dates";
import { cutoffAt } from "@/domain/cutoff";
import type { LocalDate } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import { escapeLike } from "./orderQueries";

export const LOGS_PAGE_SIZE = 50;
/** Orders a single search term may expand to (one customer, or one number across years). */
const MAX_SEARCH_ORDERS = 500;

const ORDER_NO_RE = /^\d{4}-\d{3,}$/;

/** Empty strings from a search form count as "not given". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const localDate = z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" });

export const logsQuerySchema = z.object({
  q: optional(z.string().trim().max(100)),
  entityId: optional(z.string().trim().max(64)),
  from: optional(localDate),
  to: optional(localDate),
  cursor: optional(z.string().max(200)),
});

export type LogsQuery = z.output<typeof logsQuerySchema>;

export interface LogRow {
  id: string;
  /** ISO instant. */
  at: string;
  /** Chicago time, e.g. "10/29 20:05". */
  atLabel: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Set when the entity is an order. */
  orderNo: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

export interface LogsPage {
  items: LogRow[];
  nextCursor: string | null;
  /** Names of the products the rows mention (ids in limits, violations, reorders, or as the entity). */
  productNames: Record<string, string>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Product ids mentioned by one snapshot (before or after) of an audit row. */
function productIdsIn(snapshot: unknown, into: Set<string>): void {
  if (Array.isArray(snapshot)) {
    for (const x of snapshot) {
      if (isRecord(x) && typeof x.id === "string" && typeof x.sortOrder === "number") into.add(x.id);
    }
    return;
  }
  if (!isRecord(snapshot)) return;
  if (isRecord(snapshot.productLimits)) for (const id of Object.keys(snapshot.productLimits)) into.add(id);
  if (Array.isArray(snapshot.violations)) {
    for (const v of snapshot.violations) {
      if (isRecord(v) && typeof v.productId === "string") into.add(v.productId);
    }
  }
}

/** "10/29 20:05" in Chicago time. */
export function atLabelOf(at: Date): string {
  const z = new TZDate(at.getTime(), SHOP_TZ);
  const md = `${z.getMonth() + 1}/${z.getDate()}`;
  const hm = `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
  return `${md} ${hm}`;
}

/**
 * [start, end) UTC bounds of an inclusive Chicago date range. Midnight is never skipped
 * by DST in Chicago (transitions happen at 02:00), but cutoffAt() handles it either way.
 */
export function dateBounds(from?: LocalDate, to?: LocalDate): { gte?: Date; lt?: Date } {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (from) bounds.gte = cutoffAt(from, 0, "00:00");
  if (to) bounds.lt = cutoffAt(addDays(to, 1), 0, "00:00");
  return bounds;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const invalid = () =>
    new AppError("VALIDATION", { extra: { fields: { cursor: "Invalid cursor" } } });
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  if (sep < 0) throw invalid();
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !z.uuid().safeParse(id).success) throw invalid();
  return { at, id };
}

/** Order ids for a search term: an order number (any year) or a WeChat ID. */
async function orderIdsForSearch(db: DbClient, q: string): Promise<string[]> {
  const where: Prisma.OrderWhereInput = ORDER_NO_RE.test(q)
    ? { orderNo: q }
    // Insensitive equality is an ILIKE: escape % and _ so they match themselves only.
    : { wechatId: { equals: escapeLike(q), mode: "insensitive" } };
  const orders = await db.order.findMany({
    where,
    select: { id: true },
    orderBy: [{ pickupDate: "desc" }, { seq: "asc" }],
    take: MAX_SEARCH_ORDERS,
  });
  return orders.map((o) => o.id);
}

export async function listLogs(db: DbClient, query: LogsQuery): Promise<LogsPage> {
  const and: Prisma.AuditLogWhereInput[] = [];

  if (query.q) {
    const ids = await orderIdsForSearch(db, query.q);
    if (ids.length === 0) return { items: [], nextCursor: null, productNames: {} };
    and.push({ entityType: "Order", entityId: { in: ids } });
  }
  if (query.entityId) and.push({ entityId: query.entityId });

  const { gte, lt } = dateBounds(query.from, query.to);
  if (gte || lt) and.push({ at: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } });

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    and.push({ OR: [{ at: { lt: c.at } }, { at: c.at, id: { lt: c.id } }] });
  }

  const rows = await db.auditLog.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: LOGS_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > LOGS_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, LOGS_PAGE_SIZE) : rows;

  const orderIds = [...new Set(page.filter((r) => r.entityType === "Order").map((r) => r.entityId))]
    .filter((id) => z.uuid().safeParse(id).success);
  const orders = orderIds.length
    ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } })
    : [];
  const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));

  const productIds = new Set<string>();
  for (const r of page) {
    if (r.entityType === "Product") productIds.add(r.entityId);
    productIdsIn(r.before, productIds);
    productIdsIn(r.after, productIds);
  }
  const products = [...productIds].filter((id) => z.uuid().safeParse(id).success);
  const productRows = products.length
    ? await db.product.findMany({ where: { id: { in: products } }, select: { id: true, name: true } })
    : [];
  const productNames = Object.fromEntries(productRows.map((p) => [p.id, p.name]));

  const items: LogRow[] = page.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    atLabel: atLabelOf(r.at),
    actor: r.actor,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    orderNo: r.entityType === "Order" ? (orderNoById.get(r.entityId) ?? null) : null,
    before: r.before,
    after: r.after,
    reason: r.reason,
  }));
  const last = page[page.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.at, last.id) : null, productNames };
}
