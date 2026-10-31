import { SWING_PERIOD_TICKS, type GrabState } from "../../src/lib/grab";
import { fieldLength, firstContact, swingAngle } from "../../src/lib/grab/geometry";

/** Aim at the centre of the widest visible bread window, using the engine's geometry. */
export function aimGrabBread(state: GrabState): { tick: number; margin: number } {
  if (state.over || state.claw.phase !== "idle") throw new Error("Cannot aim a busy or completed grab");
  let start = state.tick + 10;
  let best: { tick: number; margin: number } | undefined;
  // Two periods include a whole window even when it straddles the search boundary.
  const end = Math.min(start + 2 * SWING_PERIOD_TICKS, state.tick + state.timeLeft - 1);
  for (let tick = start; tick < end; tick++) {
    const angle = swingAngle(tick);
    const hit = firstContact(angle, 0, fieldLength(angle), state.items);
    if (!hit || state.items[hit.index].kind !== "bread") {
      start = tick + 1;
      continue;
    }
    const margin = Math.floor((tick - start) / 2);
    if (!best || margin > best.margin) best = { tick: start + margin, margin };
  }
  // Leave at least one tick on either side for the gap between rAF and input delivery.
  if (!best || best.margin < 1) throw new Error(`No stable bread window after tick ${state.tick}`);
  return best;
}
