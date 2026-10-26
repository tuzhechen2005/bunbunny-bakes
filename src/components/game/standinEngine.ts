// Local stand-in for src/lib/game (L1) so the UI can run before the real engine lands. Same surface as
// the contract; NOT the scoring authority (the server replays with the real engine). To switch:
// engine.ts imports `createGame` from "@/lib/game" instead of from here, and this file is deleted.
import type { Body, CreateGameOptions, GameEvent, RawEngine } from "./types";

const DT = 1 / 120;
const GRAVITY = 2.4;
const DANGER_STEPS = 180;

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface P {
  tier: number;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  age: number;
  above: number;
}

export function createGame(opts: CreateGameOptions): RawEngine {
  const { tiers, height } = opts;
  let a = hash(opts.seed);
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const piece = () => Math.min(2, Math.floor(rand() * 3));
  const queue = [piece(), piece()];
  const parts: P[] = [];
  const events: GameEvent[] = [];
  const dangerY = 0.2;
  let score = 0;
  let over = false;

  function merge() {
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const p = parts[i];
        const q = parts[j];
        if (p.tier !== q.tier) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const rr = p.r + q.r;
        if (dx * dx + dy * dy > rr * rr * 1.0004) continue;
        const x = (p.x + q.x) / 2;
        const y = (p.y + q.y) / 2;
        parts.splice(j, 1);
        parts.splice(i, 1);
        if (p.tier === tiers.length - 1) {
          score += 500;
          events.push({ type: "merge", tier: p.tier, x, y, points: 500, big: true });
        } else {
          const t = p.tier + 1;
          const pts = tiers[t].points;
          score += pts;
          parts.push({ tier: t, x, y, px: x, py: y, r: tiers[t].radius, age: 0, above: 0 });
          events.push({ type: "merge", tier: t, x, y, points: pts, big: t === tiers.length - 1 });
        }
        return true;
      }
    }
    return false;
  }

  return {
    dangerY,
    nextPiece: (k = 0) => queue[k === 1 ? 1 : 0],
    drop(x) {
      const tier = queue.shift()!;
      queue.push(piece());
      const r = tiers[tier].radius;
      const cx = Math.min(1 - r, Math.max(r, x));
      parts.push({ tier, x: cx, y: r, px: cx, py: r, r, age: 0, above: 0 });
      events.push({ type: "drop", tier, x: cx, y: r });
    },
    step() {
      if (over) return;
      for (const p of parts) {
        const vx = (p.x - p.px) * 0.995;
        const vy = (p.y - p.py) * 0.995;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * DT * DT;
        p.age++;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          for (let j = i + 1; j < parts.length; j++) {
            const q = parts[j];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const rr = p.r + q.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const push = (rr - d) / d;
            const wp = (q.r * q.r) / (p.r * p.r + q.r * q.r);
            p.x -= dx * push * wp;
            p.y -= dy * push * wp;
            q.x += dx * push * (1 - wp);
            q.y += dy * push * (1 - wp);
          }
          if (p.x < p.r) p.x = p.r;
          if (p.x > 1 - p.r) p.x = 1 - p.r;
          if (p.y < p.r) p.y = p.r;
          if (p.y > height - p.r) {
            p.y = height - p.r;
            p.px = p.x - (p.x - p.px) * 0.9;
          }
        }
      }
      while (merge());
      let danger = false;
      for (const p of parts) {
        if (p.age > 60 && p.y - p.r < dangerY) {
          p.above++;
          if (p.above > DANGER_STEPS) danger = true;
        } else p.above = 0;
      }
      if (danger) {
        over = true;
        events.push({ type: "over" });
      }
    },
    state: () => ({ bodies: parts.map((p): Body => ({ tier: p.tier, x: p.x, y: p.y, r: p.r })) }),
    get score() {
      return score;
    },
    get over() {
      return over;
    },
    drainEvents() {
      return events.splice(0, events.length);
    },
  } as RawEngine & { dangerY: number };
}
