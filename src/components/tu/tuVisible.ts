// C7 (D128): tiles entirely covered by higher layers are hidden. Written to work before and after the
// engine carries `visible` / `reveal`: a missing `visible` counts as true, an unknown event is ignored.
import type { TuEvent, TuTile } from "@/lib/tu";

/** False only when the engine says so; older engine states have no such field. */
export const isVisible = (t: TuTile): boolean => (t as TuTile & { visible?: boolean }).visible !== false;

/** Ids of the tiles that just became visible after a tap (`reveal` events, in any number). */
export function revealedIds(events: readonly TuEvent[]): number[] {
  const out: number[] = [];
  for (const e of events as readonly { type: string; tiles?: unknown }[]) {
    if (e.type === "reveal" && Array.isArray(e.tiles)) for (const id of e.tiles) if (typeof id === "number") out.push(id);
  }
  return out;
}
