// Audit log listing (API_SPEC GET /api/admin/logs): newest first, cursor pagination.

import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { SHOP_TZ, addDays, isLocalDate } from "@/domain/dates";
import { cutoffAt } from "@/domain/cutoff";
import type { LocalDate } from "@/domain/types";
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { AppError } from "./errors";

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
    : { wechatId: { equals: q, mode: "insensitive" } };
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
    if (ids.length === 0) return { items: [], nextCursor: null };
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
  return { items, nextCursor: hasMore && last ? encodeCursor(last.at, last.id) : null };
}
