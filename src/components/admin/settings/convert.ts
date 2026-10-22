// Form <-> API conversions for the settings page. Pure, no React.

/** "5" / "5.5" / "5.50" / "$5" -> cents; null when not a plain amount with <= 2 decimals. */
export function dollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").trim();
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 500 -> "5", 550 -> "5.50", 505 -> "5.05". */
export function centsToDollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

/** Non-negative integer from a text input; null otherwise. */
export function parseIntStrict(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}

/** HH:MM and not 01:00-02:59 (DST gap/overlap in Chicago); same rule as the server. */
export function isAllowedCutoffTime(hm: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 60 || minutes >= 180;
}

export const codePointLength = (s: string) => [...s].length;
