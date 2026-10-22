// Dollars <-> integer cents without any float math (CLAUDE.md rule 4).

export type CentsParse = { ok: true; cents: number } | { ok: false };

/** Largest amount the product API accepts (src/server/products.ts MAX_CENTS), in cents. */
const MAX_CENTS = 1_000_000;

/**
 * "2.49" -> 249, "10" -> 1000, "0.1" -> 10, "$3" -> 300. Rejects more than two decimals
 * ("1.005"), signs, exponents, thousands separators, empty input and amounts above the cap.
 */
export function parseDollarsToCents(input: string): CentsParse {
  const text = input.trim().replace(/^\$/, "");
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents > MAX_CENTS) return { ok: false };
  return { ok: true, cents };
}

/** 249 -> "2.49", 1000 -> "10.00" (for filling an input). */
export function centsToDollarInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
