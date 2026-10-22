// Zod schemas for changing existing orders (API_SPEC.md POST /api/o/{token}/cancel,
// PATCH /api/admin/orders/{id}, POST …/status, …/correct-status, …/payment).
//
// Lengths are counted in Unicode code points, like Postgres char_length() in the CHECKs.
// Rules mirror src/server/orderSchemas.ts (same limits, imported from there).

import { z } from "zod";
import { isLocalDate } from "@/domain/dates";
import { MAX_LINES, MAX_QTY_SCHEMA, NOTE_MAX, REASON_MAX, WECHAT_MAX } from "./orderSchemas";

const codePoints = (s: string) => [...s].length;

export const ORDER_STATUSES = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
] as const;

export const PAID_METHODS = ["WECHAT", "ZELLE", "VENMO", "CASH", "OTHER"] as const;

const orderId = z.uuid();

/** The order's `updatedAt` as the client last saw it (ISO 8601, ms precision). */
const expectedUpdatedAt = z.iso.datetime({ offset: true });

/** Optional; trimmed; "" -> null. */
const reason = z
  .string()
  .trim()
  .refine((s) => codePoints(s) <= REASON_MAX, { message: `At most ${REASON_MAX} characters` })
  .nullish()
  .transform((s) => (s ? s : null));

const cartLine = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_QTY_SCHEMA),
});

const wechatId = z
  .string()
  .trim()
  .refine((s) => codePoints(s) >= 1, { message: "Required" })
  .refine((s) => codePoints(s) <= WECHAT_MAX, { message: `At most ${WECHAT_MAX} characters` });

/** undefined = unchanged; null or "" (after trim) = cleared. */
const note = z
  .string()
  .trim()
  .refine((s) => codePoints(s) <= NOTE_MAX, { message: `At most ${NOTE_MAX} characters` })
  .nullable()
  .optional()
  .transform((s) => (s === undefined ? undefined : s ? s : null));

function requireReasonForOverride(v: { override: boolean; reason: string | null }, ctx: z.RefinementCtx) {
  if (v.override && !v.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required to override" });
  }
}

export const adminChangeStatusSchema = z.object({
  orderId,
  to: z.enum(ORDER_STATUSES),
  reason,
  expectedUpdatedAt,
});

export const adminCorrectStatusSchema = z
  .object({
    orderId,
    to: z.enum(ORDER_STATUSES),
    reason,
    override: z.boolean().optional().default(false),
    expectedUpdatedAt,
  })
  .superRefine((v, ctx) => {
    if (!v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" });
    }
  });

export const adminSetPaymentSchema = z.object({
  orderId,
  paid: z.boolean(),
  method: z
    .enum(PAID_METHODS)
    .nullish()
    .transform((s) => s ?? null),
  expectedUpdatedAt,
});

export const adminEditOrderSchema = z
  .object({
    orderId,
    items: z.array(cartLine).min(1).max(MAX_LINES).optional(),
    pickupDate: z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" }).optional(),
    fulfillment: z.enum(["PICKUP", "DELIVERY"]).optional(),
    wechatId: wechatId.optional(),
    note,
    override: z.boolean().optional().default(false),
    reason,
    expectedUpdatedAt,
  })
  .superRefine((v, ctx) => {
    requireReasonForOverride(v, ctx);
    if (
      v.items === undefined &&
      v.pickupDate === undefined &&
      v.fulfillment === undefined &&
      v.wechatId === undefined &&
      v.note === undefined
    ) {
      ctx.addIssue({ code: "custom", path: [], message: "Nothing to change" });
    }
  });

export type AdminChangeStatusData = z.output<typeof adminChangeStatusSchema>;
export type AdminCorrectStatusData = z.output<typeof adminCorrectStatusSchema>;
export type AdminSetPaymentData = z.output<typeof adminSetPaymentSchema>;
export type AdminEditOrderData = z.output<typeof adminEditOrderSchema>;
