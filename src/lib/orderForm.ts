// Pure helpers for the admin order form (create + edit): the request payloads, the
// display-only price estimate, and the OVER_LIMIT lines. No React, no fetch.
// The server recomputes every price and limit (CLAUDE.md rule 4); the estimate is
// only a preview for the owner.

import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import { priceCart } from "@/domain/pricing";
import type { Fulfillment, LocalDate, Violation } from "@/domain/types";

/** The order as GET /api/admin/orders/{id} returns it (fields the edit form needs). */
export interface EditableOrder {
  id: string;
  orderNo: string;
  status: string;
  pickupDate: LocalDate;
  fulfillment: Fulfillment;
  wechatId: string;
  note: string | null;
  items: {
    productId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    bundleSize: number;
    bundlePriceCents: number | null;
    /** F1 snapshot (null = legacy line without a flavour). */
    flavorId?: string | null;
    flavorName?: string | null;
  }[];
  /** ISO 8601; sent back as `expectedUpdatedAt`. */
  updatedAt: string;
}

export interface FormLine {
  productId: string;
  qty: number;
  /** F1: chosen flavour; `null` = explicitly keep a legacy no-flavour line; absent = product has no flavours. */
  flavorId?: string | null;
}

/** Line identity: product + flavour ("pid", "pid::fid" or "pid::-" for an explicit legacy null). */
export function formLineKey(l: Pick<FormLine, "productId" | "flavorId">): string {
  return l.flavorId === undefined ? l.productId : `${l.productId}::${l.flavorId ?? "-"}`;
}

export interface PriceSource {
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
}

export interface FormValues {
  items: FormLine[];
  pickupDate: LocalDate | "";
  fulfillment: Fulfillment;
  wechatId: string;
  note: string;
}

/** Drops zero / invalid quantities and merges duplicate product + flavour lines. */
export function cleanLines(lines: FormLine[]): FormLine[] {
  const totals = new Map<string, FormLine>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) continue;
    const k = formLineKey(l), prev = totals.get(k);
    totals.set(k, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
  }
  return [...totals.values()];
}

export interface Estimate {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
}

/** Display-only total. Lines whose product has no price source are skipped. */
export function estimate(
  lines: FormLine[],
  prices: Record<string, PriceSource>,
  fulfillment: Fulfillment,
  fees: { deliveryFeeCents: number; freeDeliveryMinCents: number },
): Estimate {
  // Prices are keyed by formLineKey (flavour lines carry their own price), falling back to the product.
  const priced = cleanLines(lines).flatMap((l) => {
    const price = prices[formLineKey(l)] ?? prices[l.productId];
    return price ? [{ productId: formLineKey(l), qty: l.qty, price }] : [];
  });
  const r = priceCart(priced, fulfillment, fees);
  return { subtotalCents: r.subtotalCents, deliveryFeeCents: r.deliveryFeeCents, totalCents: r.totalCents };
}

export interface Override {
  override: true;
  reason: string;
}

export interface CreatePayload {
  items: FormLine[];
  pickupDate: string;
  fulfillment: Fulfillment;
  wechatId: string;
  note: string;
  override?: true;
  reason?: string;
}

/** Body of POST /api/admin/orders. */
export function buildCreatePayload(v: FormValues, override?: Override): CreatePayload {
  return {
    items: cleanLines(v.items),
    pickupDate: v.pickupDate,
    fulfillment: v.fulfillment,
    wechatId: v.wechatId.trim(),
    note: v.note.trim(),
    ...(override ? { override: true as const, reason: override.reason.trim() } : {}),
  };
}

export interface EditPayload {
  items?: FormLine[];
  pickupDate?: string;
  fulfillment?: Fulfillment;
  wechatId?: string;
  note?: string;
  expectedUpdatedAt: string;
  override?: true;
  reason?: string;
}

function sameLines(a: FormLine[], b: FormLine[]): boolean {
  const key = (l: FormLine[]) =>
    cleanLines(l)
      .map((x) => `${formLineKey(x)}:${x.qty}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

/**
 * Body of PATCH /api/admin/orders/{id}: only the fields that differ from `original`
 * (the server rejects an edit that changes nothing), or null when nothing changed.
 */
export function buildEditPayload(
  original: FormValues,
  current: FormValues,
  expectedUpdatedAt: string,
  override?: Override,
): EditPayload | null {
  const diff: Omit<EditPayload, "expectedUpdatedAt" | "override" | "reason"> = {};
  if (!sameLines(original.items, current.items)) diff.items = cleanLines(current.items);
  if (current.pickupDate && current.pickupDate !== original.pickupDate) diff.pickupDate = current.pickupDate;
  if (current.fulfillment !== original.fulfillment) diff.fulfillment = current.fulfillment;
  if (current.wechatId.trim() !== original.wechatId.trim()) diff.wechatId = current.wechatId.trim();
  if (current.note.trim() !== original.note.trim()) diff.note = current.note.trim();
  if (Object.keys(diff).length === 0) return null;
  return {
    ...diff,
    expectedUpdatedAt,
    ...(override ? { override: true as const, reason: override.reason.trim() } : {}),
  };
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

function safeDay(date: string): string {
  try {
    return dayLabel(date);
  } catch {
    return date;
  }
}

/** One Chinese line per OVER_LIMIT violation (API_SPEC §3 example). */
export function describeViolation(v: Violation, productNames: Record<string, string>): string {
  const t = copy.admin.orderForm.violation;
  const day = safeDay(v.date);
  switch (v.kind) {
    case "DOUGH":
      return fill(t.dough, { day, limit: v.limit, after: v.after, over: v.over });
    case "PRODUCT":
      return fill(t.product, {
        day,
        name: productNames[v.productId] ?? t.unknownProduct,
        limit: v.limit,
        after: v.after,
        over: v.over,
      });
    case "DELIVERY":
      return fill(t.delivery, { day, limit: v.limit, after: v.after, over: v.over });
    case "DELIVERY_DISABLED":
      return fill(t.deliveryDisabled, { day });
    case "WEEKDAY":
      return fill(t.weekday, {
        day,
        name: productNames[v.productId] ?? t.unknownProduct,
        days: weekdaysLabel(v.weekdays),
      });
  }
}

/** "周三、周六" for [3, 6] (copy.dates.weekdays, joined). */
export function weekdaysLabel(days: readonly number[]): string {
  return days
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .map((d) => copy.dates.weekdays[d])
    .join(copy.admin.products.weekdaySeparator);
}

/** Defensive parse of `violations` from an OVER_LIMIT response body. */
export function parseViolations(raw: unknown): Violation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is Violation =>
      !!x && typeof x === "object" && typeof (x as { kind?: unknown }).kind === "string",
  );
}
