// Shop settings (API_SPEC GET/PUT /api/admin/settings). `orderingEnabled` is owned by the
// dashboard toggle and is deliberately not part of this update.

import { z } from "zod";
import { copy } from "@/copy";
import type { Setting } from "@/generated/prisma/client";
import { writeAudit } from "./audit";
import type { DbClient } from "./db";
import { loadSettings } from "./day";
import { AppError } from "./errors";
import { issuesToFields } from "./orderSchemas";

const codePoints = (s: string) => [...s].length;
/** Keeps every integer well inside Postgres INT. */
const INT_MAX = 100_000_000;

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** HH:MM, not 01:00-02:59 (the DST gap/overlap hours in Chicago). */
export function isAllowedCutoffTime(hm: string): boolean {
  const m = HM_RE.exec(hm);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 60 || minutes >= 180;
}

const nonNegInt = z.number().int().min(0).max(INT_MAX);

function text(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((s) => codePoints(s) >= min, { message: "Too short" })
    .refine((s) => codePoints(s) <= max, { message: `At most ${max} characters` });
}

export const settingsUpdateSchema = z.object({
  cutoffTime: z
    .string()
    .refine((s) => HM_RE.test(s), { message: "Expected HH:MM" })
    .refine((s) => !HM_RE.test(s) || isAllowedCutoffTime(s), {
      message: copy.admin.settings.cutoffTimeInvalid,
    }),
  defaultDoughLimitG: nonNegInt,
  defaultDeliveryLimit: nonNegInt,
  deliveryFeeCents: nonNegInt,
  freeDeliveryMinCents: nonNegInt,
  maxQtyPerItem: z.number().int().min(1).max(99),
  ownerWechatId: text(0, 40),
  showWechatOnHome: z.boolean(),
  pickupNote: text(0, 100),
  bakingTextBread: text(1, 40),
  bakingTextOther: text(1, 40),
  // Unknown keys (e.g. orderingEnabled) are stripped, never applied.
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const SETTINGS_FIELDS = [
  "cutoffTime",
  "defaultDoughLimitG",
  "defaultDeliveryLimit",
  "deliveryFeeCents",
  "freeDeliveryMinCents",
  "maxQtyPerItem",
  "ownerWechatId",
  "showWechatOnHome",
  "pickupNote",
  "bakingTextBread",
  "bakingTextOther",
] as const satisfies readonly (keyof SettingsUpdate)[];

/**
 * Validates a PUT body. Throws AppError VALIDATION with per-field messages; the DST
 * cutoff message also becomes the top-level message so the form can show it as is.
 */
export function parseSettingsUpdate(body: unknown): SettingsUpdate {
  const result = settingsUpdateSchema.safeParse(body);
  if (result.success) return result.data;
  const fields = issuesToFields(result.error);
  const message =
    fields.cutoffTime === copy.admin.settings.cutoffTimeInvalid ? fields.cutoffTime : undefined;
  throw new AppError("VALIDATION", { message, extra: { fields } });
}

/** Every Setting field except id, plus updatedAt as an ISO string. */
export interface SettingsView extends SettingsUpdate {
  orderingEnabled: boolean;
  updatedAt: string;
}

function toView(s: Setting): SettingsView {
  return {
    orderingEnabled: s.orderingEnabled,
    cutoffTime: s.cutoffTime,
    defaultDoughLimitG: s.defaultDoughLimitG,
    defaultDeliveryLimit: s.defaultDeliveryLimit,
    deliveryFeeCents: s.deliveryFeeCents,
    freeDeliveryMinCents: s.freeDeliveryMinCents,
    maxQtyPerItem: s.maxQtyPerItem,
    ownerWechatId: s.ownerWechatId,
    showWechatOnHome: s.showWechatOnHome,
    pickupNote: s.pickupNote,
    bakingTextBread: s.bakingTextBread,
    bakingTextOther: s.bakingTextOther,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function getSettingsView(db: DbClient): Promise<SettingsView> {
  return db.$transaction(async (tx) => toView(await loadSettings(tx)));
}

/**
 * Full update. Writes one `settings.update` AuditLog row holding only the changed
 * fields (before/after) in the same transaction; no change = no write, no audit row.
 */
export async function updateSettings(
  db: DbClient,
  input: SettingsUpdate,
  now: Date,
): Promise<SettingsView> {
  return db.$transaction(async (tx) => {
    // Serialize concurrent saves so before/after are exact.
    await tx.$queryRaw`SELECT 1 FROM "Setting" WHERE "id" = 1 FOR UPDATE`;
    const current = await loadSettings(tx);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of SETTINGS_FIELDS) {
      if (current[key] !== input[key]) {
        before[key] = current[key];
        after[key] = input[key];
      }
    }
    if (Object.keys(after).length === 0) return toView(current);

    const updated = await tx.setting.update({ where: { id: 1 }, data: after });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "settings.update",
      entityType: "Setting",
      entityId: "1",
      before,
      after,
      at: now,
    });
    return toView(updated);
  });
}
