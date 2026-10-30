// C8 (D131, D132): props and readable orders. Written to work before and after the engine carries them:
// no `use` / no `props` in the state means "no props bar"; unknown events are ignored.
import type { TuEvent, TuGame, TuState } from "@/lib/tu";

export type PropKind = "peek" | "bag" | "swap";
export const PROP_KINDS: readonly PropKind[] = ["peek", "bag", "swap"];
export type PropCounts = Record<PropKind, number>;

type Loose = { type: string } & Record<string, unknown>;
const loose = (events: readonly TuEvent[]) => events as unknown as readonly Loose[];
const isProp = (x: unknown): x is PropKind => x === "peek" || x === "bag" || x === "swap";

/** A tap-log entry: a tile tap or a prop use (one strictly increasing log). */
export type TuLogEntry = { id: number; at: number } | { p: PropKind; at: number };
export const isPropEntry = (e: TuLogEntry): e is { p: PropKind; at: number } => "p" in e;

/** The engine part of C8, when present. */
export const canUse = (g: TuGame | null): g is TuGame & { use: (p: PropKind) => TuEvent[] | null } =>
  !!g && typeof (g as { use?: unknown }).use === "function";

export function propsOf(s: TuState): PropCounts | null {
  const p = (s as { props?: Partial<PropCounts> }).props;
  if (!p || typeof p !== "object") return null;
  const n = (k: PropKind) => (typeof p[k] === "number" && p[k]! > 0 ? Math.floor(p[k]!) : 0);
  return { peek: n("peek"), bag: n("bag"), swap: n("swap") };
}

/** 6 or 7. */
export const bagSizeOf = (s: TuState, fallback: number): number => {
  const n = (s as { bagSize?: unknown }).bagSize;
  return n === 7 ? 7 : n === 6 ? 6 : fallback;
};

/** Reward points of the two orders, if the state has them (`rewards`, `orderRewards` or `orderPoints`). */
export function rewardsOf(s: TuState): [number, number] | null {
  const o = s as unknown as Record<string, unknown>;
  for (const k of ["rewards", "orderRewards", "orderPoints"]) {
    const a = o[k];
    if (Array.isArray(a) && a.length >= 2 && typeof a[0] === "number" && typeof a[1] === "number") return [a[0], a[1]];
  }
  return null;
}

export interface PropEvents {
  used: PropKind | null;
  gained: PropKind[];
  bagSize: number | null;
  bonus: number;
}
export function propEvents(events: readonly TuEvent[]): PropEvents {
  const out: PropEvents = { used: null, gained: [], bagSize: null, bonus: 0 };
  for (const e of loose(events)) {
    if (e.type === "prop" && isProp(e.p)) out.used = e.p;
    else if (e.type === "gain" && isProp(e.p)) out.gained.push(e.p);
    else if (e.type === "bagSize" && typeof e.size === "number") out.bagSize = e.size;
    else if (e.type === "bonus" && typeof e.points === "number") out.bonus += e.points;
  }
  return out;
}
