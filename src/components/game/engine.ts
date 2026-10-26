// The only file that knows where the engine comes from. Until L1's src/lib/game lands the UI runs on a
// local stand-in with the same surface; swapping is this one import (and deleting standinEngine.ts).
import { createGame } from "./standinEngine"; // -> import { createGame } from "@/lib/game";
import type { Body, DropLog, GameEvent, RawEngine, TierView } from "./types";

/** Simulation constants of the contract. */
export const STEP_DT = 1 / 120;
export const MIN_DROP_GAP = 30;
export const MAX_DROPS = 600;
export const MAX_STEPS = 200_000;
export const BOARD_HEIGHT = 1.5;
/** Danger line, world units from the top. L1's engine exposes `dangerY` when it has one. */
export const DEFAULT_DANGER_Y = 0.2;

/** One play-through: the engine, the step counter and the drop log that is sent to the server. */
export class Session {
  readonly engine: RawEngine;
  readonly drops: DropLog[] = [];
  steps = 0;
  private lastDropAt = 0;
  readonly dangerY: number;
  /** Set when the client caps are reached before the engine says it is over. */
  private capped = false;

  constructor(
    readonly tiers: TierView[],
    seed: string,
  ) {
    this.engine = createGame({
      seed,
      tiers: tiers.map((t) => ({ id: t.id, radius: t.radius, points: t.points })),
      width: 1,
      height: BOARD_HEIGHT,
    });
    const d = (this.engine as { dangerY?: unknown }).dangerY;
    this.dangerY = typeof d === "number" ? d : DEFAULT_DANGER_Y;
  }

  get score() {
    return this.engine.score;
  }
  get over() {
    return this.engine.over || this.capped;
  }
  get bodies(): Body[] {
    return this.engine.state().bodies;
  }
  current(): number {
    return this.engine.nextPiece(0);
  }
  upcoming(): number {
    return this.engine.nextPiece(1);
  }
  /** 0..1: how far the cool-down has run since the last drop. */
  get cooled(): number {
    return Math.min(1, Math.max(0, (this.steps - this.lastDropAt) / MIN_DROP_GAP));
  }
  canDrop(): boolean {
    return !this.over && this.drops.length < MAX_DROPS && this.steps - this.lastDropAt >= MIN_DROP_GAP;
  }
  /** Drops the current piece at x (world units, clamped to the walls). */
  drop(x: number): GameEvent | null {
    if (!this.canDrop()) return null;
    const tier = this.current();
    const r = this.tiers[tier].radius;
    const cx = Math.min(1 - r, Math.max(r, x));
    this.engine.drop(cx);
    this.drops.push({ x: cx, at: this.steps });
    this.lastDropAt = this.steps;
    return { type: "drop", tier, x: cx, y: r };
  }
  /** Advances `n` fixed steps; returns the events in order. */
  advance(n: number): GameEvent[] {
    const out: GameEvent[] = [];
    for (let i = 0; i < n && !this.over; i++) {
      this.engine.step();
      this.steps++;
      const ev = this.engine.drainEvents();
      if (ev.length) out.push(...ev);
      // The server replays at most MAX_DROPS drops / MAX_STEPS steps: end the run at either cap.
      if (this.steps >= MAX_STEPS || (this.drops.length >= MAX_DROPS && this.steps - this.lastDropAt >= 600)) {
        this.capped = true;
        out.push({ type: "over" });
      }
    }
    return out;
  }
}
