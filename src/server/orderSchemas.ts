// Zod schemas for creating orders (API_SPEC.md POST /api/orders, POST /api/admin/orders;
// SECURITY.md §4). The honeypot `website` field is handled by the route, not here.
//
// Lengths are counted in Unicode code points, like Postgres char_length() in the CHECKs.

import { z } from "zod";
import { isLocalDate } from "@/domain/dates";
import { copy } from "@/copy";
import { AppError } from "./errors";

const F = copy.errors.fields;

/** Schema-level qty bound; the per-item business limit (Setting.maxQtyPerItem) is checked later. */
export const MAX_QTY_SCHEMA = 100;
/** Max cart lines per request. */
export const MAX_LINES = 50;
export const WECHAT_MAX = 40;
export const NOTE_MAX = 300;
export const REASON_MAX = 500;

const codePoints = (s: string) => [...s].length;

const cartLine = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_QTY_SCHEMA),
});

const pickupDate = z.string().refine(isLocalDate, { message: F.pickupDate });

const wechatId = z
  .string()
  .trim()
  .refine((s) => codePoints(s) >= 1, { message: F.wechatId })
  .refine((s) => codePoints(s) <= WECHAT_MAX, { message: F.wechatId });

/** Optional; trimmed; "" -> null. */
const note = z
  .string()
  .trim()
  .refine((s) => codePoints(s) <= NOTE_MAX, { message: F.note })
  .nullish()
  .transform((s) => (s ? s : null));

const baseShape = {
  items: z.array(cartLine).min(1).max(MAX_LINES),
  pickupDate,
  fulfillment: z.enum(["PICKUP", "DELIVERY"]),
  wechatId,
  note,
};

export const customerOrderSchema = z.object({
  ...baseShape,
  // v4 only (crypto.randomUUID()): rejects nil / max / other versions, which a buggy client
  // could share between customers.
  idempotencyKey: z
    .uuidv4()
    .nullish()
    .transform((s) => s ?? null),
});

export const adminOrderSchema = z
  .object({
    ...baseShape,
    override: z.boolean().optional().default(false),
    reason: z
      .string()
      .trim()
      .refine((s) => codePoints(s) <= REASON_MAX, { message: F.reason })
      .nullish()
      .transform((s) => (s ? s : null)),
  })
  .superRefine((v, ctx) => {
    if (v.override && !v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: F.reason });
    }
  });

export type CustomerOrderData = z.output<typeof customerOrderSchema>;
export type AdminOrderData = z.output<typeof adminOrderSchema>;

/** `{ "items.0.qty": "…" }`; the first issue per path wins. Root issues use the key "_". */
export function issuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/** Customer-safe Chinese message for a built-in zod issue (wrong type, missing, too big...). */
function fallbackMessage(path: PropertyKey[]): string {
  const head = String(path[0] ?? "");
  if (path[path.length - 1] === "qty") return F.qty;
  if (head === "items") return F.items;
  if (head === "wechatId" || head === "note" || head === "pickupDate" || head === "fulfillment" || head === "reason") {
    return F[head];
  }
  return F.other;
}

/** Like issuesToFields, but every message is Chinese and safe to show customers. */
export function orderIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    if (key in fields) continue;
    // Our own refinements (code "custom") already carry copy; built-in issues do not.
    fields[key] = issue.code === "custom" ? issue.message : fallbackMessage(issue.path);
  }
  return fields;
}

/** Parses or throws AppError VALIDATION with `extra.fields`. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION", { extra: { fields: orderIssuesToFields(result.error) } });
  }
  return result.data;
}
