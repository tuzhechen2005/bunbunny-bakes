// Compact before/after field diff for the log list. Pure, no React.

import { copy } from "@/copy";

const t = copy.admin.logs;

export interface DiffLine {
  key: string;
  label: string;
  /** Formatted old value; null when there was no "before" at all (a creation). */
  from: string | null;
  to: string;
}

const MAX_VALUE_CHARS = 80;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(s: string): string {
  const chars = [...s];
  return chars.length > MAX_VALUE_CHARS ? `${chars.slice(0, MAX_VALUE_CHARS).join("")}…` : s;
}

function dollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, "0")}`;
}

export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return t.emptyValue;
  if (typeof value === "boolean") return value ? t.yes : t.no;
  if (typeof value === "number") {
    return key.endsWith("Cents") && Number.isInteger(value) && value >= 0 ? dollars(value) : String(value);
  }
  if (typeof value === "string") return clip(value);
  return clip(JSON.stringify(value));
}

export function fieldLabel(key: string): string {
  const fields = t.fields as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : key;
}

/**
 * Only the keys whose value differs. With no "before" (e.g. a creation) every key of
 * "after" is listed without an old value. Non-object snapshots give an empty list.
 */
export function diffLines(before: unknown, after: unknown): DiffLine[] {
  const b = isPlainObject(before) ? before : null;
  const a = isPlainObject(after) ? after : null;
  if (!b && !a) return [];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  const lines: DiffLine[] = [];
  for (const key of keys) {
    const from = b && Object.hasOwn(b, key) ? b[key] : undefined;
    const to = a && Object.hasOwn(a, key) ? a[key] : undefined;
    if (b && a && JSON.stringify(from) === JSON.stringify(to)) continue;
    lines.push({
      key,
      label: fieldLabel(key),
      from: b ? formatValue(key, from) : null,
      to: formatValue(key, to),
    });
  }
  return lines;
}
