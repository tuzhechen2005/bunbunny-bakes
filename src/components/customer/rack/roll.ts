/** Digit-roll plan for a changing price (prototype `roll`). Pure: tests/unit/rackRoll.test.ts. */

export interface RollSlot {
  /** Character shown before ("" = nothing). */
  from: string;
  /** Character shown after. */
  to: string;
  /** Only changed slots animate. */
  changed: boolean;
  /** Stagger in ms: the last digit moves first. */
  delayMs: number;
}

export interface RollPlan {
  slots: RollSlot[];
  /** True when the number grows: digits leave upwards and arrive from below. */
  up: boolean;
}

const num = (s: string) => parseFloat(s.replace(/[^\d.]/g, "")) || 0;

/** Slot-by-slot plan for going from `from` to `to`, right aligned (so "$9.99" -> "$10.99" grows leftwards). */
export function planRoll(from: string, to: string, staggerMs = 30): RollPlan {
  const n = Math.max(from.length, to.length);
  const a = from.padStart(n, " ");
  const b = to.padStart(n, " ");
  const slots: RollSlot[] = [];
  for (let j = 0; j < n; j++) {
    if (a[j] === " " && b[j] === " ") continue;
    slots.push({
      from: a[j] === " " ? "" : a[j],
      to: b[j] === " " ? "" : b[j],
      changed: a[j] !== b[j],
      delayMs: (n - 1 - j) * staggerMs,
    });
  }
  return { slots, up: num(to) >= num(from) };
}
