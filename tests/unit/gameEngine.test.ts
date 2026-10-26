import { describe, expect, it } from "vitest";
import {
  BIG_BIG_BONUS,
  createGame,
  createRng,
  defaultTierDefs,
  DROP_COOLDOWN_STEPS,
  hashState,
  MAX_DROPS,
  MAX_STEPS,
  OVER_STEPS,
  GRACE_STEPS,
  replay,
  ReplayError,
  type Game,
  type ReplayDrop,
  type TierDef,
} from "@/lib/game";
import { botRun, greedyRun } from "../support/gameBot";

const TIERS = defaultTierDefs(["a", "b", "c", "d", "e"]);
const SMALL: TierDef[] = [
  { id: "a", radius: 0.1, points: 0 },
  { id: "b", radius: 0.14, points: 10 },
  { id: "big", radius: 0.3, points: 30 },
];

function run(g: Game, n: number) {
  for (let i = 0; i < n; i++) g.step();
}

describe("rng", () => {
  it("is deterministic and seed dependent", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    const c = createRng("seed-2");
    const xs = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it("known values never change (replays depend on them)", () => {
    const r = createRng("bunbunny");
    expect([r.int(1000), r.int(1000), r.int(1000), r.int(1000)]).toMatchInlineSnapshot(`
      [
        910,
        797,
        367,
        859,
      ]
    `);
  });

  it("int stays in range and covers it", () => {
    const r = createRng("range");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = r.int(3);
      expect(v >= 0 && v < 3 && Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });
});

describe("pieces", () => {
  it("only the smallest 3 tiers come out, never the big one", () => {
    const g = createGame({ seed: "p", tiers: TIERS, width: 1, height: 1.5 });
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      seen.add(g.nextPiece());
      run(g, 1); // advance nothing meaningful
      g.drop(0.1 + (i % 8) * 0.1);
      run(g, DROP_COOLDOWN_STEPS);
      if (g.over) break;
    }
    expect([...seen].every((t) => t >= 0 && t <= 2)).toBe(true);
    expect(seen.size).toBe(3);
  });

  it("with only two product tiers (3 tiers in all) drops only the product tiers", () => {
    const g = createGame({ seed: "p", tiers: SMALL, width: 1, height: 1.5 });
    for (let i = 0; i < 30; i++) {
      expect(g.nextPiece()).toBeLessThan(2);
      g.drop(0.5);
      run(g, DROP_COOLDOWN_STEPS);
    }
  });

  it("nextPiece is stable until a drop, and the preview becomes the hand", () => {
    const g = createGame({ seed: "q", tiers: TIERS, width: 1, height: 1.5 });
    const { hand, preview } = g.state();
    expect(g.nextPiece()).toBe(hand);
    run(g, 5);
    expect(g.nextPiece()).toBe(hand);
    g.drop(0.5);
    expect(g.nextPiece()).toBe(preview);
  });
});

describe("drop", () => {
  it("clamps x so the piece stays inside the walls", () => {
    const g = createGame({ seed: "c", tiers: TIERS, width: 1, height: 1.5 });
    const tier = g.nextPiece();
    const r = TIERS[tier].radius;
    g.drop(-5);
    expect(g.state().bodies[0].x).toBe(r);
    run(g, DROP_COOLDOWN_STEPS);
    const tier2 = g.nextPiece();
    g.drop(9);
    expect(g.state().bodies[1].x).toBe(1 - TIERS[tier2].radius);
    run(g, DROP_COOLDOWN_STEPS);
    g.drop(Number.NaN);
    expect(Number.isFinite(g.state().bodies[2].x)).toBe(true);
  });

  it("enforces the 30-step cool-down", () => {
    const g = createGame({ seed: "cd", tiers: TIERS, width: 1, height: 1.5 });
    expect(g.drop(0.5)).not.toBeNull();
    run(g, DROP_COOLDOWN_STEPS - 1);
    expect(g.canDrop()).toBe(false);
    expect(g.drop(0.5)).toBeNull();
    g.step();
    expect(g.canDrop()).toBe(true);
    expect(g.drop(0.2)).not.toBeNull();
  });

  it("emits drop events", () => {
    const g = createGame({ seed: "ev", tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.5);
    const ev = g.drainEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].type).toBe("drop");
    expect(g.drainEvents()).toEqual([]);
  });
});

describe("merging", () => {
  // Hand pieces come from the RNG, so find a seed whose first two pieces are equal.
  function twinSeed(tiers: TierDef[], tier: number): string {
    for (let i = 0; i < 500; i++) {
      const g = createGame({ seed: `twin-${i}`, tiers, width: 1, height: 1.5 });
      const s = g.state();
      if (s.hand === tier && s.preview === tier) return `twin-${i}`;
    }
    throw new Error("no twin seed");
  }

  it("two equal tiers become one of the next tier at the midpoint and score its points", () => {
    const seed = twinSeed(TIERS, 0);
    const g = createGame({ seed, tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.45);
    run(g, DROP_COOLDOWN_STEPS);
    g.drop(0.55); // lands on the first and rolls; they meet on the floor
    g.drainEvents();
    for (let i = 0; i < 1200 && g.score === 0; i++) g.step();
    expect(g.score).toBe(TIERS[1].points);
    const s = g.state();
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0].tier).toBe(1);
    expect(s.bodies[0].r).toBe(TIERS[1].radius);
    const merge = g.drainEvents().find((e) => e.type === "merge");
    expect(merge).toMatchObject({ type: "merge", tier: 1, points: TIERS[1].points, bigBig: false });
  });

  it("different tiers do not merge", () => {
    const g = createGame({ seed: "mix", tiers: TIERS, width: 1, height: 1.5 });
    // Place a tier-0 and force-check a different tier next to it.
    let dropped = 0;
    const tiersSeen: number[] = [];
    while (dropped < 2) {
      tiersSeen.push(g.nextPiece());
      g.drop(0.3 + 0.4 * dropped);
      dropped++;
      run(g, DROP_COOLDOWN_STEPS);
    }
    run(g, 600);
    if (tiersSeen[0] !== tiersSeen[1]) {
      expect(g.score).toBe(0);
      expect(g.state().bodies).toHaveLength(2);
    }
  });

  it("two big tiers vanish and score the 500 bonus", () => {
    // Drive the engine through its public surface only: stack many pieces until a big appears,
    // then keep playing; across a long bot game at least one big+big happens for tiny tier sets.
    const tiers: TierDef[] = [
      { id: "a", radius: 0.18, points: 0 },
      { id: "b", radius: 0.25, points: 10 },
      { id: "big", radius: 0.3, points: 30 },
    ];
    let found = false;
    for (let seed = 0; seed < 40 && !found; seed++) {
      const g = createGame({ seed: `bb-${seed}`, tiers, width: 1, height: 1.5 });
      const rng = createRng(`bot-${seed}`);
      for (let i = 0; i < 120 && !g.over && !found; i++) {
        g.drop(rng.next());
        for (let k = 0; k < DROP_COOLDOWN_STEPS + 40 && !g.over; k++) {
          g.step();
          for (const e of g.drainEvents()) {
            if (e.type === "merge" && e.bigBig) {
              found = true;
              expect(e.points).toBe(BIG_BIG_BONUS);
            }
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it("cascades: a merge that creates a neighbour of the same tier merges again", () => {
    let best = 0;
    for (let s = 0; s < 30; s++) {
      const g = createGame({ seed: `cascade-${s}`, tiers: TIERS, width: 1, height: 1.5 });
      const rng = createRng(`aim-${s}`);
      for (let i = 0; i < 80 && !g.over; i++) {
        g.drop(rng.next());
        let merges = 0;
        for (let k = 0; k < DROP_COOLDOWN_STEPS; k++) {
          g.step();
          merges += g.drainEvents().filter((e) => e.type === "merge").length;
        }
        best = Math.max(best, merges);
      }
    }
    // A plain merge is 1; the bot piles enough that at least one drop cascades.
    expect(best).toBeGreaterThanOrEqual(2);
  });
});

describe("physics sanity", () => {
  it("bodies stay inside the box and settle", () => {
    const g = createGame({ seed: "box", tiers: TIERS, width: 1, height: 1.5 });
    const rng = createRng("box-aim");
    for (let i = 0; i < 40 && !g.over; i++) {
      g.drop(rng.next());
      run(g, DROP_COOLDOWN_STEPS);
    }
    const s = g.state();
    for (const b of s.bodies) {
      expect(b.x).toBeGreaterThanOrEqual(b.r - 1e-9);
      expect(b.x).toBeLessThanOrEqual(1 - b.r + 1e-9);
      expect(b.y).toBeLessThanOrEqual(1.5 - b.r + 1e-9);
      expect(Number.isFinite(b.y)).toBe(true);
    }
  });

  it("a lone piece falls to the floor and the world falls asleep", () => {
    const g = createGame({ seed: "floor", tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.5);
    expect(g.asleep).toBe(false);
    run(g, 1500);
    const b = g.state().bodies[0];
    expect(b.y).toBeCloseTo(1.5 - b.r, 3);
    expect(g.asleep).toBe(true);
  });
});

describe("game over", () => {
  it("ends once a body stays above the danger line for more than 1.5 s, not before", () => {
    const g = createGame({ seed: "stack", tiers: STACK_TIERS, width: 1, height: 1.5 });
    const rng = createRng("stack-aim");
    let streak = 0; // consecutive steps with any body's top edge above the line (grace ignored)
    let overStreak = -1;
    for (let i = 0; i < 60000 && !g.over; i++) {
      if (g.canDrop()) g.drop(Math.floor(rng.next() * 1000) / 1000);
      g.step();
      const s = g.state();
      streak = s.bodies.some((b) => b.y - b.r < s.dangerY) ? streak + 1 : 0;
      if (g.over) overStreak = streak;
    }
    expect(g.over).toBe(true);
    // Lower bound: more than OVER_STEPS counted steps are needed.
    expect(overStreak).toBeGreaterThan(OVER_STEPS);
  });

  it("a big pile comes to rest and the world sleeps", () => {
    const g = createGame({ seed: "pile", tiers: TIERS, width: 1, height: 1.5 });
    const rng = createRng("pile-aim");
    for (let i = 0; i < 14 && !g.over; i++) {
      g.drop(rng.next());
      run(g, 70);
    }
    expect(g.over).toBe(false);
    run(g, 4000);
    expect(g.asleep).toBe(true);
  });

  it("does not end for a piece that is merely in flight (grace period)", () => {
    const g = createGame({ seed: "flight", tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.5);
    run(g, GRACE_STEPS - 1);
    expect(g.over).toBe(false);
  });

  it("over fires exactly once, after more than OVER_STEPS steps above the line", () => {
    const { over, overStep, aboveSince } = botOverTiming();
    expect(over).toBe(true);
    expect(overStep - aboveSince).toBeGreaterThan(OVER_STEPS - 1);
  });

  it("refuses drops after game over", () => {
    const g = overGame();
    expect(g.over).toBe(true);
    expect(g.drop(0.5)).toBeNull();
    expect(g.canDrop()).toBe(false);
    const events = g.drainEvents().filter((e) => e.type === "over");
    expect(events).toHaveLength(1);
  });
});

/** Random aim at the fastest pace: the board fills up and the game ends. */
const STACK_TIERS: TierDef[] = TIERS;

function overRun() {
  const g = createGame({ seed: "stack", tiers: STACK_TIERS, width: 1, height: 1.5 });
  const rng = createRng("stack-aim");
  const log: ReplayDrop[] = [];
  for (let i = 0; i < 60000 && !g.over; i++) {
    if (g.canDrop()) {
      const x = Math.floor(rng.next() * 1000) / 1000;
      log.push({ x, at: g.steps });
      g.drop(x);
    }
    g.step();
  }
  return { g, log };
}

function overGame(): Game {
  return overRun().g;
}

function botOverTiming() {
  const g = overGame();
  const st = g.state();
  // The tallest top edge of settled bodies is above the line at the moment of game over.
  const top = Math.min(...st.bodies.map((b) => b.y - b.r));
  expect(top).toBeLessThan(st.dangerY);
  // Approximate: replaying with a stop one step earlier must not be over.
  const e = g.steps;
  const again = overGame();
  expect(again.steps).toBe(e);
  return { over: g.over, overStep: e, aboveSince: e - OVER_STEPS - 1 };
}

describe("determinism", () => {
  it("same inputs give identical state hashes at every checkpoint", () => {
    const a = botRun("det-1", TIERS, 60);
    const b = botRun("det-1", TIERS, 60);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.log).toEqual(b.log);
    expect(a.score).toBe(b.score);
    const c = botRun("det-2", TIERS, 60);
    expect(c.hashes).not.toEqual(a.hashes);
  });

  it("replaying the bot's drop log reproduces its score exactly", () => {
    for (const seed of ["r1", "r2", "r3"]) {
      const bot = botRun(seed, TIERS, 200);
      const res = replay(seed, TIERS, bot.log);
      expect(res.score).toBe(bot.score);
      expect(res.over).toBe(bot.over);
    }
  });

  it("pinned vector: fixed seed and drops give a known score and hash", () => {
    const bot = botRun("pinned", TIERS, 40);
    expect({ score: bot.score, over: bot.over, steps: bot.steps, hash: bot.finalHash, drops: bot.log.length }).toMatchInlineSnapshot(`
      {
        "drops": 37,
        "hash": "6870e4d0",
        "over": true,
        "score": 1220,
        "steps": 2155,
      }
    `);
  });

  it("hashState changes when any body moves", () => {
    const g = createGame({ seed: "h", tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.5);
    const h1 = hashState(g.state());
    g.step();
    expect(hashState(g.state())).not.toBe(h1);
  });
});

describe("caps end the game inside the engine", () => {
  it("ends at MAX_STEPS even when nothing happens, and then refuses drops", () => {
    const g = createGame({ seed: "idle", tiers: TIERS, width: 1, height: 1.5 });
    g.drop(0.5);
    while (g.steps < MAX_STEPS - 1) g.step();
    expect(g.over).toBe(false);
    g.step();
    expect(g.over).toBe(true);
    expect(g.steps).toBe(MAX_STEPS);
    expect(g.drop(0.5)).toBeNull();
    expect(g.drainEvents().filter((e) => e.type === "over")).toHaveLength(1);
  });

  it("ends after the MAX_DROPS-th drop (client and server agree on the score)", () => {
    // Small pieces on a big board: long games that can reach the cap.
    const ROOMY: TierDef[] = [0.045, 0.06, 0.075, 0.09, 0.105].map((radius, i) => ({
      id: `r${i}`,
      radius,
      points: (i * (i + 1) * 10) / 2,
    }));
    ROOMY.push({ id: "big", radius: 0.15, points: 150 });
    let found: ReturnType<typeof greedyRun> | null = null;
    for (let s = 0; s < 40 && !found; s++) {
      const r = greedyRun(`cap${s}`, ROOMY, MAX_DROPS, 40);
      if (r.drops === MAX_DROPS) found = r;
    }
    expect(found).not.toBeNull();
    const r = found!;
    expect(r.over).toBe(true);
    const res = replay(`cap${r.seedIndex}`, ROOMY, r.log);
    expect(res).toMatchObject({ score: r.score, over: true });
    // One more drop than the cap is rejected outright.
    const extra = [...r.log, { x: 0.5, at: r.log[r.log.length - 1].at + 30 }];
    expect(() => replay(`cap${r.seedIndex}`, ROOMY, extra)).toThrow(ReplayError);
  });
});

describe("replay", () => {
  const ok: ReplayDrop[] = [
    { x: 0.5, at: 0 },
    { x: 0.2, at: 30 },
    { x: 0.8, at: 90 },
  ];

  it("rejects drops inside the cool-down", () => {
    expect(() => replay("s", TIERS, [{ x: 0.5, at: 0 }, { x: 0.5, at: 29 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, [{ x: 0.5, at: 10 }, { x: 0.5, at: 10 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, [{ x: 0.5, at: 50 }, { x: 0.5, at: 20 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, ok)).not.toThrow();
  });

  it("rejects malformed numbers", () => {
    expect(() => replay("s", TIERS, [{ x: Number.NaN, at: 0 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, [{ x: 0.5, at: 1.5 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, [{ x: 0.5, at: -1 }])).toThrow(ReplayError);
    expect(() => replay("s", TIERS, [{ x: 0.5, at: MAX_STEPS + 1 }])).toThrow(ReplayError);
  });

  it("caps the number of drops", () => {
    const many = Array.from({ length: MAX_DROPS + 1 }, (_, i) => ({ x: 0.5, at: i * 30 }));
    expect(() => replay("s", TIERS, many)).toThrow(/too many/);
  });

  it("rejects a drop after game over", () => {
    const { g, log } = overRun();
    const after = [...log, { x: 0.5, at: g.steps + 30 }];
    expect(() => replay("stack", STACK_TIERS, after)).toThrow(/after game over/);
  });

  it("an empty log scores 0", () => {
    expect(replay("s", TIERS, [])).toMatchObject({ score: 0, over: false });
  });

  it("counts cascades after the last drop and stays bounded", () => {
    const bot = botRun("tail", TIERS, 30);
    const res = replay("tail", TIERS, bot.log);
    expect(res.steps).toBeLessThanOrEqual(MAX_STEPS);
    expect(res.score).toBe(bot.score);
  });
});
