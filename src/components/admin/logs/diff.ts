// Human-readable before/after field diff for the audit logs (the log list and the order
// detail page). Pure, no React. Nothing here prints raw JSON, ISO timestamps or English
// enum values: every known shape is turned into Chinese, money and Chicago wall time.

import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { dayLabel, SHOP_TZ } from "@/domain/dates";
import type { Fulfillment, LocalDate, OrderStatus } from "@/domain/types";
import { statusLabel } from "../orders/statusUi";
import { describeViolation, parseViolations, weekdaysLabel } from "@/lib/orderForm";

const t = copy.admin.logs;
const orders = copy.admin.orders;

export interface DiffLine {
  key: string;
  label: string;
  /** Formatted old value; null when there was no "before" at all (a creation). */
  from: string | null;
  to: string;
}

/** Looks up product names (by id) for per-product limits and violations. */
export interface FormatContext {
  productNames?: Record<string, string>;
  /** Of the order the log belongs to: READY reads 配送中 on a delivery order. */
  fulfillment?: Fulfillment;
}

const MAX_TEXT_CHARS = 120;
/** Bookkeeping fields nobody needs to read in a change list. */
const HIDDEN_KEYS = new Set(["id", "createdAt", "updatedAt", "paidAt", "archivedAt", "lineTotalCents"]);
/** Shown for a change, but noise when a record is simply created. */
const HIDDEN_ON_CREATE = new Set(["cutoffAt", "sortOrder"]);

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function clip(s: string): string {
  const chars = [...s];
  return chars.length > MAX_TEXT_CHARS ? `${chars.slice(0, MAX_TEXT_CHARS).join("")}…` : s;
}

export function dollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

/** "10/29 20:05" in America/Chicago. */
export function chicagoTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return false;
}

function pick(map: Record<string, string>, v: string): string {
  return has(map, v) ? map[v] : v;
}

function productName(id: string, ctx: FormatContext): string {
  const names = ctx.productNames;
  return names && has(names, id) ? names[id] : t.unknownProduct;
}

function formatItems(list: unknown[]): string {
  return list
    .map((raw) => {
      if (isPlainObject(raw) && typeof raw.name === "string") {
        return fill(t.itemChip, { name: raw.name, qty: typeof raw.qty === "number" ? raw.qty : "" });
      }
      return formatValue("", raw);
    })
    .join(t.listSeparator);
}

export function formatValue(key: string, value: unknown, ctx: FormatContext = {}): string {
  if (key === "pickupWeekdays" && Array.isArray(value)) {
    return value.length === 0 ? t.everyDay : weekdaysLabel(value.filter((d): d is number => typeof d === "number"));
  }
  if (isEmpty(value)) return t.emptyValue;
  if (typeof value === "boolean") return value ? t.yes : t.no;
  if (typeof value === "number") {
    return key.endsWith("Cents") && Number.isInteger(value) && value >= 0 ? dollars(value) : String(value);
  }
  if (typeof value === "string") {
    switch (key) {
      case "status":
        return has(orders.statusLabels, value)
          ? statusLabel(value as OrderStatus, ctx.fulfillment)
          : pick(t.productStatuses, value);
      case "fulfillment":
        return pick(t.fulfillments, value);
      case "paidMethod":
        return pick(orders.paymentMethods, value);
      case "source":
        return pick(t.sources, value);
      case "capacityMode":
        return pick(t.capacityModes, value);
      case "imageUrl":
        return t.hasPhoto;
    }
    if (ISO_INSTANT.test(value)) return chicagoTime(value);
    if (PLAIN_DATE.test(value)) {
      // Free text or legacy values can look like a date without being one (2026-02-30).
      try {
        return dayLabel(value as LocalDate);
      } catch {
        return clip(value);
      }
    }
    return clip(value);
  }
  if (Array.isArray(value)) {
    if (key === "images") return value.map((u) => String(u).slice(-10, -4)).join(" → ");
    if (key === "violations") {
      return parseViolations(value)
        .map((v) => describeViolation(v, ctx.productNames ?? {}))
        .join("；");
    }
    return formatItems(value);
  }
  if (isPlainObject(value)) {
    if (key === "productLimits") {
      return Object.entries(value)
        .filter(([, limit]) => limit !== null)
        .map(([id, limit]) => fill(t.limitChip, { name: productName(id, ctx), limit: String(limit) }))
        .join(t.listSeparator);
    }
    return Object.entries(value)
      .map(([k, v]) => `${fieldLabel(k)} ${formatValue(k, v, ctx)}`)
      .join(t.listSeparator);
  }
  return clip(String(value));
}

export function fieldLabel(key: string): string {
  const fields = t.fields as Record<string, string>;
  return has(fields, key) ? fields[key] : key;
}

/** product.reorder stores [{id, sortOrder}] on both sides. */
function isOrderList(v: unknown): v is { id: string; sortOrder: number }[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => isPlainObject(x) && typeof x.id === "string" && typeof x.sortOrder === "number")
  );
}

function orderNames(list: { id: string; sortOrder: number }[], ctx: FormatContext): string {
  return [...list]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((x) => productName(x.id, ctx))
    .join(" → ");
}

/**
 * Only the keys whose value differs. With no "before" (e.g. a creation) every key of
 * "after" is listed without an old value, except empty ones (no 「备注：无」 on a new order).
 * Non-object snapshots give an empty list, except a product reorder.
 */
export function diffLines(before: unknown, after: unknown, ctx: FormatContext = {}): DiffLine[] {
  if (isOrderList(after)) {
    const from = isOrderList(before) ? orderNames(before, ctx) : null;
    const to = orderNames(after, ctx);
    return from === to ? [] : [{ key: "order", label: fieldLabel("order"), from, to }];
  }
  const b = isPlainObject(before) ? before : null;
  const a = isPlainObject(after) ? after : null;
  if (!b && !a) return [];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  const lines: DiffLine[] = [];
  for (const key of keys) {
    if (HIDDEN_KEYS.has(key)) continue;
    const from = b && Object.hasOwn(b, key) ? b[key] : undefined;
    const to = a && Object.hasOwn(a, key) ? a[key] : undefined;
    if (b && a && JSON.stringify(from) === JSON.stringify(to)) continue;
    if (!b && (isEmpty(to) || HIDDEN_ON_CREATE.has(key))) continue;
    // A deletion: show what was removed, not a column of empty values.
    if (b && !a && isEmpty(from)) continue;
    lines.push({
      key,
      label: fieldLabel(key),
      from: b && a ? formatValue(key, from, ctx) : null,
      to: formatValue(key, a ? to : from, ctx),
    });
  }
  return lines;
}
