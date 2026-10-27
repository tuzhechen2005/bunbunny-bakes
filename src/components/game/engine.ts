// The UI's view of the deterministic engine (src/lib/game, L1): a Session wraps one run, keeps the drop
// log that is sent to the server and maps engine events to what the effects code wants.
import { createGame, DROP_COOLDOWN_STEPS, STEP, type Game, type GameEvent as EngineEvent } from "@/lib/game";
import type { Body, DropLog, GameEvent, TierView } from "./types";

export const STEP_DT = STEP;
export const BOARD_HEIGHT = 1.5;

function mapEvent(ev: EngineEvent, lastTier: number): GameEvent {
  if (ev.type === "merge") {
    return { type: "merge", tier: ev.tier, x: ev.x, y: ev.y, points: ev.points, big: ev.bigBig || ev.tier === lastTier, bigBig: ev.bigBig };
  }
  if (ev.type === "drop") return { type: "drop", tier: ev.tier, x: ev.x, y: ev.y };
  return { type: "over" };
}

export class Session {
  readonly game: Game;
  readonly drops: DropLog[] = [];
  readonly dangerY: number;

  constructor(
    readonly tiers: TierView[],
    seed: string,
  ) {
    this.game = createGame({
      seed,
      tiers: tiers.map((t) => ({ id: t.id, radius: t.radius, points: t.points })),
      width: 1,
      height: BOARD_HEIGHT,
    });
    this.dangerY = this.game.state().dangerY;
  }

  /**
   * Rebuilds a saved run (D111) by replaying its drops through the deterministic engine. Returns null
   * when the log cannot be replayed (corrupt save): the caller then discards it.
   */
  static restore(tiers: TierView[], seed: string, drops: readonly DropLog[]): Session | null {
    const s = new Session(tiers, seed);
    for (const d of drops) {
      if (!d || !Number.isInteger(d.at) || d.at < s.steps || typeof d.x !== "number" || !Number.isFinite(d.x)) return null;
      while (s.steps < d.at) {
        if (s.over) return null;
        s.game.step();
      }
      if (s.over || s.game.drop(d.x) === null) return null;
      s.game.drainEvents();
      s.drops.push({ x: d.x, at: d.at });
    }
    return s.over ? null : s;
  }

  get steps() {
    return this.game.steps;
  }
  get score() {
    return this.game.score;
  }
  get asleep() {
    return this.game.asleep;
  }
  get over() {
    return this.game.over;
  }
  get bodies(): Body[] {
    return this.game.state().bodies;
  }
  /** Tier of the piece in hand. */
  current(): number {
    return this.game.nextPiece();
  }
  /** Tier of the piece after it. */
  upcoming(): number {
    return this.game.state().preview;
  }
  /** 0..1: how far the cool-down has run since the last drop. */
  get cooled(): number {
    const s = this.game.stepsSinceDrop();
    return Number.isFinite(s) ? Math.min(1, s / DROP_COOLDOWN_STEPS) : 1;
  }
  canDrop(): boolean {
    return this.game.canDrop();
  }
  /** Drops the hand piece at x; returns the resulting events, or null when blocked (cool-down, game over). */
  drop(x: number): GameEvent[] | null {
    const at = this.game.steps;
    const id = this.game.drop(x);
    if (id === null) return null;
    const body = this.game.state().bodies.find((b) => b.id === id);
    this.drops.push({ x: body ? body.x : Math.min(1, Math.max(0, x)), at });
    return this.drain();
  }
  /** Advances `n` fixed steps; returns the events in order. */
  advance(n: number): GameEvent[] {
    const out: GameEvent[] = [];
    for (let i = 0; i < n && !this.game.over; i++) {
      this.game.step();
      out.push(...this.drain());
    }
    return out;
  }
  private drain(): GameEvent[] {
    const last = this.tiers.length - 1;
    return this.game.drainEvents().map((e) => mapEvent(e, last));
  }
}
