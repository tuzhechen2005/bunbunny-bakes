// Typed client helpers for the customer API (docs/API_SPEC.md §1–2).
// Never throws: every call resolves to { ok: true, data } or { ok: false, error }.

import { copy } from "@/copy";
import type { CartItem } from "./cart";

export type Fulfillment = "PICKUP" | "DELIVERY";

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  /** The cover: `images[0] ?? null`. */
  imageUrl: string | null;
  /** Public photo URLs in display order, cover first (0-6). */
  images: string[];
  /** The product's home colours (hex), always present. */
  field: { bg: string; ink: string; ink2: string };
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  status: "ACTIVE" | "PAUSED";
  leadDays: number;
}

export interface Menu {
  orderingEnabled: boolean;
  products: MenuProduct[];
  pickupNote: string;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number;
  maxQtyPerItem: number;
  /** Present only when the owner chose to show it on the home page (D44). */
  ownerWechatId?: string | null;
}

export type DateState = "AVAILABLE" | "CUTOFF" | "FULL" | "DELIVERY_FULL";

export interface DateOption {
  date: string;
  state: DateState;
  /** Only for AVAILABLE dates. */
  cutoffAt?: string;
  cutoffLabel?: string;
}

export interface CartProblem {
  productId: string;
  error: string;
}

export interface Availability {
  orderingEnabled: boolean;
  pricing: {
    subtotalCents: number;
    deliveryFeeCents: number;
    totalCents: number;
    freeDeliveryGapCents: number;
  };
  cartProblems: CartProblem[];
  dates: DateOption[];
}

export interface OrderRequest {
  items: CartItem[];
  pickupDate: string;
  fulfillment: Fulfillment;
  wechatId: string;
  note: string;
  idempotencyKey: string;
  website: string;
}

export interface OrderCreated {
  orderNo: string;
  viewToken: string;
  url: string;
}

/** Error body of API_SPEC §1; `NETWORK` = no usable response. */
export interface ApiError {
  error: string;
  message: string;
  suggestion?: string | null;
  fields?: Record<string, string>;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError };

function toApiError(body: unknown): ApiError {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const error = typeof b.error === "string" && b.error ? b.error : "UNKNOWN";
  const message = typeof b.message === "string" && b.message ? b.message : copy.errors.fallback;
  const result: ApiError = { error, message };
  if (typeof b.suggestion === "string" || b.suggestion === null) result.suggestion = b.suggestion;
  if (b.fields && typeof b.fields === "object") {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(b.fields as Record<string, unknown>)) {
      if (typeof value === "string") fields[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") fields[key] = value[0];
    }
    result.fields = fields;
  }
  return result;
}

async function request<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init ? { "content-type": "application/json" } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: { error: "NETWORK", message: copy.errors.fallback } };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  if (response.ok && body !== null) return { ok: true, status: response.status, data: body as T };
  return { ok: false, status: response.status, error: toApiError(body) };
}

export function fetchMenu(): Promise<ApiResult<Menu>> {
  return request<Menu>("/api/menu");
}

export function fetchAvailability(
  items: readonly CartItem[],
  fulfillment: Fulfillment,
): Promise<ApiResult<Availability>> {
  return request<Availability>("/api/availability", {
    method: "POST",
    body: { items: items.map(({ productId, qty }) => ({ productId, qty })), fulfillment },
  });
}

export function submitOrder(body: OrderRequest): Promise<ApiResult<OrderCreated>> {
  return request<OrderCreated>("/api/orders", { method: "POST", body });
}

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <A extends Uint8Array>(array: A) => A;
}

/**
 * RFC 4122 v4 UUID. Uses crypto.randomUUID when present; otherwise builds one from
 * crypto.getRandomValues (older WeChat Android webviews lack randomUUID).
 */
export function uuidV4(c: CryptoLike | undefined = globalThis.crypto as CryptoLike | undefined): string {
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fall through (randomUUID can throw outside secure contexts in some engines)
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
