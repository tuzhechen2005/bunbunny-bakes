// 消除大面包 engine: a deterministic merge-the-fruit style physics game (D100-D105).
//
// Pure TS: no DOM, no Date.now, no Math.random. Everything is computed with + - * / and
// Math.sqrt/min/max/abs/floor only (all correctly rounded or exact in IEEE 754), so the same
// inputs give bit-identical results in V8 and JavaScriptCore. Do NOT add sin/cos/exp/pow/hypot.
//
// World: x in [0, 1] (width), y grows downward in [0, height]. Fixed step 1/120 s. The server
// replays a run from (seed, tiers, drops) and the client plays the same engine, so the score is
// verifiable without trusting the client.

import { createRng, type Rng } from "./rng";

export interface TierDef {
  id: string;
  /** In world units (width = 1). */
  radius: number;
  /** Score for merging two of the previous tier into this one. */
  points: number;
}

export type GameEvent =
  | { type: "drop"; step: number; tier: number; x: number; y: number }
  | {
      type: "merge";
      step: number;
      /** Tier of the new body. */
      tier: number;
      x: number;
      y: number;
      points: number;
      /** Two 大面包 vanished (bonus). */
      bigBig: boolean;
    }
  | { type: "over"; step: number };

export interface Body {
  id: number;
  tier: number;
  x: number;
  y: number;
  r: number;
}

export interface GameState {
  bodies: Body[];
  score: number;
  over: boolean;
  steps: number;
  /** Tier index of the piece the next drop() places, and the one after it. */
  hand: number;
  preview: number;
  dangerY: number;
  width: number;
  height: number;
}

export interface GameOptions {
  seed: string;
  tiers: readonly TierDef[];
  width: 1;
  height: number;
}

export const STEP = 1 / 120;
export const GRAVITY = 7;
export const ITERATIONS = 6;
/** Minimum steps between two drops (0.25 s). */
export const DROP_COOLDOWN_STEPS = 30;
/** A body above the danger line for more than this many steps (1.5 s) ends the game. */
export const OVER_STEPS = 180;
/** A new body is ignored by the danger check for this long, so a piece in flight is not "above the line". */
export const GRACE_STEPS = 90;
/** Hard caps: the engine ends the game here, so client and server agree on the final score. */
export const MAX_DROPS = 600;
export const MAX_STEPS = 200_000;
export const BIG_BIG_BONUS = 500;
export const DEFAULT_HEIGHT = 1.5;
/** Danger line, from the top of the board. */
export const DANGER_Y = 0.26;
/** Only the smallest tiers are ever dropped. */
export const DROP_TIERS = 3;

const DAMPING = 0.994;
const FLOOR_FRICTION = 0.8;
const WALL_FRICTION = 0.9;
const MERGE_SLACK = 1.02;
/** Largest positional correction per body per pair and iteration, and largest travel per step (world units). */
const MAX_PUSH = 0.006;
const MAX_SPEED = 0.04;
const QUIET = 0.00012;
const SLEEP_STEPS = 60;

/** Triangular numbers x 10 by tier index: tier 1 = 10, 2 = 30, 3 = 60, ... (tier 0 never scores). */
export function defaultPoints(index: number): number {
  return (index * (index + 1) * 10) / 2;
}

/**
 * Radius for product tier `i` of `n` (0.076 -> 0.229), rounded so snapshots stay readable. 15% larger
 * than the first tuning (0.066 -> 0.199), which owners found too easy: a game now lasts about half as long.
 */
export function defaultRadius(i: number, n: number): number {
  const t = n <= 1 ? 0 : i / (n - 1);
  return Math.round((0.076 + 0.153 * t) * 10000) / 10000;
}
export const BIG_RADIUS = 0.268;

/** `n` product tiers (>= 1) plus the 大面包 tier with the default radii and points. */
export function defaultTierDefs(ids: readonly string[]): TierDef[] {
  const n = ids.length;
  const defs: TierDef[] = ids.map((id, i) => ({ id, radius: defaultRadius(i, n), points: defaultPoints(i) }));
  defs.push({ id: "big", radius: BIG_RADIUS, points: defaultPoints(n) });
  return defs;
}

interface Internal {
  id: number;
  tier: number;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  born: number;
}

export interface Game {
  nextPiece(): number;
  /** Drops the hand piece at x (world units, clamped). Returns the new body id, or null when blocked (cool-down, game over). */
  drop(x: number): number | null;
  step(): void;
  state(): GameState;
  /** Returns and clears the events since the last call. */
  drainEvents(): GameEvent[];
  readonly score: number;
  readonly over: boolean;
  readonly steps: number;
  /** Number of drops so far. */
  readonly drops: number;
  /** True when nothing moves and nothing is pending (safe to stop simulating until the next drop). */
  readonly asleep: boolean;
  /** Steps since the last drop (Infinity before the first). */
  stepsSinceDrop(): number;
  canDrop(): boolean;
}

export function createGame(opts: GameOptions): Game {
  const tiers = opts.tiers;
  if (tiers.length < 2) throw new Error("createGame: need at least 2 tiers");
  if (tiers[tiers.length - 1].id !== "big") throw new Error('createGame: the last tier must have id "big"');
  const W = 1;
  const H = opts.height;
  const bigIndex = tiers.length - 1;
  const dropTiers = Math.max(1, Math.min(DROP_TIERS, bigIndex));
  const rng: Rng = createRng(opts.seed);

  let bodies: Internal[] = [];
  let uid = 0;
  let steps = 0;
  let score = 0;
  let over = false;
  let overTimer = 0;
  let lastDrop = -Infinity;
  let dropCount = 0;
  let quiet = 0;
  let asleep = true;
  let events: GameEvent[] = [];
  let hand = rng.int(dropTiers);
  let preview = rng.int(dropTiers);

  function dangerPending(): boolean {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (steps - b.born < GRACE_STEPS) return true;
    }
    return overTimer > 0;
  }

  function checkDanger(): void {
    let above = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (steps - b.born >= GRACE_STEPS && b.y - b.r < DANGER_Y) {
        above = true;
        break;
      }
    }
    if (above) {
      overTimer++;
      if (overTimer > OVER_STEPS && !over) {
        over = true;
        events.push({ type: "over", step: steps });
      }
    } else {
      overTimer = 0;
    }
  }

  function mergePass(): void {
    const n = bodies.length;
    let used: boolean[] | null = null;
    let created: Internal[] | null = null;
    for (let i = 0; i < n; i++) {
      if (used && used[i]) continue;
      const A = bodies[i];
      for (let j = i + 1; j < n; j++) {
        if (used && used[j]) continue;
        const B = bodies[j];
        if (A.tier !== B.tier) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const m = (A.r + B.r) * MERGE_SLACK;
        if (dx * dx + dy * dy > m * m) continue;
        if (!used) used = new Array<boolean>(n).fill(false);
        if (!created) created = [];
        used[i] = true;
        used[j] = true;
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        if (A.tier === bigIndex) {
          score += BIG_BIG_BONUS;
          events.push({ type: "merge", step: steps, tier: bigIndex, x: mx, y: my, points: BIG_BIG_BONUS, bigBig: true });
        } else {
          const tier = A.tier + 1;
          const points = tiers[tier].points;
          score += points;
          const r = tiers[tier].radius;
          // The bigger body must still fit inside the walls and under the ceiling.
          const nx = Math.min(Math.max(mx, r), W - r);
          const ny = Math.max(my, r);
          created.push({
            id: ++uid,
            tier,
            x: nx,
            y: ny,
            // Keep the average velocity so merges do not freeze the pile.
            px: nx - ((A.x - A.px + (B.x - B.px)) / 2),
            py: ny - ((A.y - A.py + (B.y - B.py)) / 2),
            r,
            born: Math.min(A.born, B.born),
          });
          events.push({ type: "merge", step: steps, tier, x: nx, y: ny, points, bigBig: false });
        }
        break;
      }
    }
    if (used) {
      const kept: Internal[] = [];
      for (let i = 0; i < n; i++) if (!used[i]) kept.push(bodies[i]);
      bodies = created ? kept.concat(created) : kept;
      quiet = 0;
      asleep = false;
    }
  }

  function physics(): number {
    const bs = bodies;
    const n = bs.length;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      const vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (b.x - b.px) * DAMPING));
      const vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (b.y - b.py) * DAMPING));
      b.px = b.x;
      b.py = b.y;
      b.x += vx;
      b.y += vy + GRAVITY * STEP * STEP;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const A = bs[i];
          const B = bs[j];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const m = A.r + B.r;
          const d2 = dx * dx + dy * dy;
          if (d2 < m * m) {
            if (d2 > 1e-12) {
              const d = Math.sqrt(d2);
              const o = Math.min((m - d) * 0.5, MAX_PUSH) / d;
              A.x -= dx * o;
              A.y -= dy * o;
              B.x += dx * o;
              B.y += dy * o;
            } else {
              // Exactly on top of each other: any direction, but deterministic.
              A.x -= 0.0005;
              B.x += 0.0005;
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const c = bs[i];
        if (c.x < c.r) {
          c.x = c.r;
          c.py = c.y - (c.y - c.py) * WALL_FRICTION;
        }
        if (c.x > W - c.r) {
          c.x = W - c.r;
          c.py = c.y - (c.y - c.py) * WALL_FRICTION;
        }
        if (c.y > H - c.r) {
          c.y = H - c.r;
          c.px = c.x - (c.x - c.px) * FLOOR_FRICTION;
        }
        // Solid ceiling at the top of the visible board: nothing ever leaves the screen upwards.
        if (c.y < c.r) {
          c.y = c.r;
          if (c.py < c.y) c.py = c.y;
        }
      }
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const e = bs[i];
      moved = Math.max(moved, Math.abs(e.x - e.px), Math.abs(e.y - e.py));
    }
    return moved;
  }

  const game: Game = {
    nextPiece: () => hand,
    canDrop: () => !over && steps - lastDrop >= DROP_COOLDOWN_STEPS,
    drop(x: number): number | null {
      if (over || steps - lastDrop < DROP_COOLDOWN_STEPS) return null;
      const tier = hand;
      hand = preview;
      preview = rng.int(dropTiers);
      const r = tiers[tier].radius;
      const cx = Number.isFinite(x) ? x : 0.5;
      const bx = Math.min(Math.max(cx, r), W - r);
      const by = r;
      const body: Internal = { id: ++uid, tier, x: bx, y: by, px: bx, py: by, r, born: steps };
      bodies.push(body);
      lastDrop = steps;
      dropCount++;
      quiet = 0;
      asleep = false;
      events.push({ type: "drop", step: steps, tier, x: bx, y: by });
      return body.id;
    },
    step(): void {
      steps++;
      if (!asleep) {
        const moved = physics();
        mergePass();
        if (moved < QUIET) {
          if (++quiet > SLEEP_STEPS) asleep = true;
        } else {
          quiet = 0;
        }
      }
      if (!over && (steps >= MAX_STEPS || (dropCount >= MAX_DROPS && steps - lastDrop >= DROP_COOLDOWN_STEPS))) {
        over = true;
        events.push({ type: "over", step: steps });
      }
      if (!over) checkDanger();
    },
    state(): GameState {
      return {
        bodies: bodies.map((b) => ({ id: b.id, tier: b.tier, x: b.x, y: b.y, r: b.r })),
        score,
        over,
        steps,
        hand,
        preview,
        dangerY: DANGER_Y,
        width: W,
        height: H,
      };
    },
    drainEvents(): GameEvent[] {
      const e = events;
      events = [];
      return e;
    },
    get score() {
      return score;
    },
    get over() {
      return over;
    },
    get steps() {
      return steps;
    },
    get drops() {
      return dropCount;
    },
    get asleep() {
      return asleep && !dangerPending();
    },
    stepsSinceDrop: () => steps - lastDrop,
  };
  return game;
}

/** FNV-1a over the exact bits of every body (and the score): equal hashes mean identical states. */
export function hashState(s: GameState): string {
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const num = (v: number) => {
    buf.setFloat64(0, v);
    mix(buf.getUint32(0));
    mix(buf.getUint32(4));
  };
  mix(s.steps);
  mix(s.score);
  mix(s.over ? 1 : 0);
  for (const b of s.bodies) {
    mix(b.id);
    mix(b.tier);
    num(b.x);
    num(b.y);
  }
  return h.toString(16).padStart(8, "0");
}
