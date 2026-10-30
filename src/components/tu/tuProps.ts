// C8 (D131, D132): typed prop events and the shared tap/prop log.
import { TU_PROPS, type TuEvent, type TuProp, type TuState } from "@/lib/tu";

export type PropKind = TuProp;
export const PROP_KINDS = TU_PROPS;
export type PropCounts = TuState["props"];

/** A tap-log entry: a tile tap or a prop use (one strictly increasing log). */
export type TuLogEntry = { id: number; at: number } | { p: PropKind; at: number };
export const isPropEntry = (e: TuLogEntry): e is { p: PropKind; at: number } => "p" in e;

export interface PropEvents {
  used: PropKind | null;
  gained: PropKind[];
  bagSize: number | null;
  bonus: number;
}
export function propEvents(events: readonly TuEvent[]): PropEvents {
  const out: PropEvents = { used: null, gained: [], bagSize: null, bonus: 0 };
  for (const e of events) {
    if (e.type === "prop") out.used = e.p;
    else if (e.type === "gain") out.gained.push(e.p);
    else if (e.type === "bagSize") out.bagSize = e.size;
    else if (e.type === "bonus") out.bonus += e.points;
  }
  return out;
}
