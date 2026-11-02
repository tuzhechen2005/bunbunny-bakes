import { createRng } from "../game/rng";
import { clawTip, fieldLength, firstContact, swingAngle } from "./geometry";
import {
  BLAST_RADIUS, BOMB_RADIUS, BOMB_PENALTY_TICKS, BOMB_RESPAWN_TICKS,
  BREAD_REFRESH_AGE, CLOCK_BONUS_TICKS, EMPTY_REEL_SPEED, EXTEND_SPEED, FIELD_ITEMS, MIN_TIERS,
  OVEN_X, OVEN_Y, REFILL_DELAY_TICKS, RUN_TICKS,
  type GrabEvent, type GrabGame, type GrabItem, type GrabKind, type GrabSize,
  MAX_RUN_TICKS, type GrabOrder, type GrabContactResult,
  type GrabStage, type GrabState, type GrabTierInput,
} from "./types";

const BREAD = {
  S: { radius: 41, weight: 1, points: 100 },
  M: { radius: 57, weight: 2, points: 180 },
  L: { radius: 73, weight: 3, points: 300 },
} as const;

export function breadStage(age: number): GrabStage {
  return age < 240 ? "raw" : age <= 540 ? "perfect" : "burnt";
}

export function breadPoints(size: GrabSize, age: number): number {
  const multiplier = age < 240 ? 5 : age <= 540 ? 15 : 3;
  return Math.trunc(BREAD[size].points * multiplier / 10);
}

/** Monotonically slower with weight; all distances are integer field units per tick. */
export function reelSpeed(weight: number): number {
  return weight >= 12 ? 2 : Math.max(5, Math.ceil((17 - weight * 4) / 0.8));
}

/** Per-level score, excluding score earned in earlier levels. */
export function grabLevelRules(level: number) {
  return { target: 900 + (level - 1) * 1100, duration: Math.max(1200, RUN_TICKS - (level - 1) * 360),
    bombs: Math.min(3, 1 + Math.floor((level - 1) / 2)), mice: level >= 3 };
}
const cloneOrder = (order: GrabOrder): GrabOrder => ({ ...order, required: [...order.required], remaining: [...order.remaining] });

interface LiveItem extends Omit<GrabItem, "age" | "stage"> { born: number; slot: number }

const cloneEvent = (e: GrabEvent): GrabEvent => {
  if (e.type === "order") return { ...e, order: cloneOrder(e.order) };
  if (e.type === "explode") return { ...e, item: { ...e.item }, destroyed: e.destroyed.map(item => ({ ...item })) };
  if (e.type === "pop") return { ...e, item: { ...e.item } };
  if (e.type === "refill") return { ...e, item: { ...e.item }, from: { ...e.from } };
  return { ...e };
};

export function createGrabGame(opts: { seed: string; tiers: readonly GrabTierInput[] }): GrabGame {
  const tierCount = opts.tiers.length;
  if (tierCount < MIN_TIERS) throw new RangeError(`grab: needs at least ${MIN_TIERS} tiers`);
  const rng = createRng(`${opts.seed}:grab`);
  let tick = 0, deadline = RUN_TICKS, score = 0, grabs = 0;
  let launchesAccepted = 0, launchesRejected = 0, lastLaunch = -1;
  let over = false, nextId = 1;
  let level = 1, levelStartScore = 0, completedOrders = 0, perfectChain = 0;
  let pendingResult: GrabContactResult | null = null;
  let order: GrabOrder = { id: 0, required: [], remaining: [], reward: 300 };
  let phase: GrabState["claw"]["phase"] = "idle";
  let angle = swingAngle(0), length = 0, edge = 0;
  let held: GrabItem | null = null;
  let events: GrabEvent[] = [];
  const items: LiveItem[] = [];
  const refills: number[] = [];
  const bombRefills: number[] = [];
  let deck: GrabKind[] = [];

  const snapshotItem = (item: LiveItem): GrabItem => {
    const { id, kind, tier, size, x, y, radius, weight, mouse, golden, velocityX } = item;
    const age = tick - item.born;
    return { id, kind, tier, size, x, y, radius, weight, mouse, golden, velocityX, age, stage: kind === "bread" ? breadStage(age) : "none" };
  };

  const spawn = (bomb = false): LiveItem => {
    // One clock per shuffled 32-item oven batch: rare, with bounded replay duration.
    if (!bomb && !deck.length) {
      deck = [...Array<GrabKind>(23).fill("bread"), "flour", ...Array<GrabKind>(7).fill("butter"), "clock"];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    const kind = bomb ? "bomb" : deck.pop()!;
    const golden = kind === "bread" && level >= 2 && rng.int(64) === 0;
    const mouse = kind === "bread" && !golden && grabLevelRules(level).mice && rng.int(5) === 0;
    const size: GrabSize = bomb || golden ? "M" : mouse ? "S" : kind === "bread" ? (["S", "M", "L"] as const)[rng.int(3)] : kind === "flour" ? "L" : "S";
    const tier = kind === "bread" ? rng.int(tierCount) : null;
    const free = Array.from({ length: 16 }, (_, i) => i).filter((slot) => !items.some((item) => item.slot === slot));
    const sides = free.filter(slot => slot % 4 === 0 || slot % 4 === 3);
    // Reserve all pending bomb slots, including the next level's larger population.
    const reservedBombSlots = 3 - items.filter(item => item.kind === "bomb").length;
    const available = bomb ? sides : sides.length <= reservedBombSlots
      ? free.filter(slot => !sides.includes(slot)) : free;
    const slot = available[rng.int(available.length)];
    return {
      id: nextId++, kind, tier, size, slot, born: tick, golden, mouse,
      velocityX: mouse ? (rng.int(2) ? 1 : -1) : 0,
      x: 90 + (slot % 4) * 180 + rng.int(29) - 14,
      y: 420 + Math.trunc(slot / 4) * 190 + rng.int(33) - 16,
      radius: bomb ? BOMB_RADIUS : kind === "bread" ? BREAD[size].radius : kind === "flour" ? 44 : 25,
      weight: golden ? 12 : kind === "bread" ? BREAD[size].weight : kind === "flour" ? 8 : 0,
    };
  };
  for (let i = 0; i < FIELD_ITEMS; i++) items.push(spawn());
  items.push(spawn(true));

  // Reserve visible ingredients immediately, including duplicate requests. No extra deck draws/clocks.
  const supplyOrder = () => {
    const reserved = new Set<number>();
    for (const tier of order.remaining) {
      let item = items.find(i => i.kind === "bread" && i.tier === tier && !reserved.has(i.id));
      if (!item) {
        item = items.find(i => i.kind === "bread" && !reserved.has(i.id));
        if (!item) {
          item = items.find(i => i.kind !== "bomb" && !reserved.has(i.id));
          if (!item) continue;
          item.kind = "bread"; item.size = "S"; item.radius = 41; item.weight = 1;
          item.golden = false; item.mouse = false;
        }
        item.tier = tier;
        item.born = tick;
        item.id = nextId++;
        events.push({ type: "refill", tick, item: snapshotItem(item), from: { x: OVEN_X, y: OVEN_Y } });
      }
      reserved.add(item.id);
    }
  };
  const newOrder = () => {
    const a = rng.int(tierCount), b = rng.int(2) ? a : rng.int(tierCount);
    order = { id: order.id + 1, required: [a, b], remaining: [a, b], reward: 2 * breadPoints("S", 240) };
    supplyOrder();
  };
  newOrder();
  events = [];

  const advance = (toTick: number) => {
    events = [];
    while (!over && tick < toTick) {
      tick++;
      // Expiry wins ties: neither a last-tick bread nor a last-tick clock is delivered.
      if (tick >= deadline || tick >= MAX_RUN_TICKS) {
        deadline = tick;
        over = true;
        events.push({ type: "over", tick });
        break;
      }
      while (refills.length && refills[0] <= tick) {
        refills.shift();
        const item = spawn();
        items.push(item);
        events.push({ type: "refill", tick, item: snapshotItem(item), from: { x: OVEN_X, y: OVEN_Y } });
      }
      while (bombRefills.length && bombRefills[0] <= tick) {
        bombRefills.shift();
        const item = spawn(true);
        items.push(item);
        events.push({ type: "refill", tick, item: snapshotItem(item), from: { x: OVEN_X, y: OVEN_Y } });
      }
      // Refresh only bread, in place, without drawing another bonus-item batch.
      // Held bread is outside this array, so its contact stage remains frozen.
      for (const item of items) {
        if (item.kind === "bread" && tick - item.born >= BREAD_REFRESH_AGE) {
          item.id = nextId++;
          item.born = tick;
          events.push({ type: "refill", tick, item: snapshotItem(item), from: { x: OVEN_X, y: OVEN_Y } });
        }
      }
      supplyOrder();
      for (const item of items) {
        if (item.mouse) {
          const vx = item.velocityX || 1;
          const x = item.x + vx;
          if (x < item.radius || x > 720 - item.radius) item.velocityX = -vx;
          else item.x = x;
        } else if (item.kind === "bread" && level >= 2 && tick % 6 === 0) {
          // Small readable tray motion; mice traverse the entire field independently.
          item.x = Math.max(item.radius, Math.min(720 - item.radius, item.x + (Math.floor(tick / 90) % 2 ? 1 : -1)));
        }
      }
      if (phase === "idle") angle = swingAngle(tick);
      else if (phase === "extending") {
        const nextLength = Math.min(edge, length + EXTEND_SPEED);
        const contact = firstContact(angle, length, nextLength, items);
        if (contact) {
          length = contact.length;
          const item = items.splice(contact.index, 1)[0];
          phase = "reeling";
          if (item.kind === "bomb") {
            const destroyed = items.filter(other => (other.x - item.x) ** 2 + (other.y - item.y) ** 2 <= BLAST_RADIUS ** 2);
            events.push({ type: "explode", tick, item: snapshotItem(item), destroyed: destroyed.map(snapshotItem), penaltyTicks: BOMB_PENALTY_TICKS });
            for (const victim of destroyed) {
              items.splice(items.indexOf(victim), 1);
              events.push({ type: "pop", tick, item: snapshotItem(victim) });
              if (victim.kind === "bomb") bombRefills.push(tick + BOMB_RESPAWN_TICKS);
              else refills.push(tick + REFILL_DELAY_TICKS);
            }
            perfectChain = 0;
            bombRefills.push(tick + BOMB_RESPAWN_TICKS);
            deadline = Math.max(tick, deadline - BOMB_PENALTY_TICKS);
            if (deadline === tick) {
              over = true;
              events.push({ type: "over", tick });
            }
          } else {
            held = snapshotItem(item);
            perfectChain = held.stage === "perfect" ? Math.min(3, perfectChain + 1) : 0;
            const multiplierPercent = 100 + Math.max(0, perfectChain - 1) * 10;
            const base = held.kind === "bread" ? breadPoints(held.size, held.age) * (held.golden ? 3 : held.mouse ? 2 : 1) : held.kind === "clock" ? 0 : 20;
            pendingResult = { item: held.id, stage: held.stage, points: Math.floor(base * multiplierPercent / 100), chain: perfectChain, multiplierPercent };
            events.push({ type: "contact", tick, ...pendingResult });
            events.push({ type: "pop", tick, item: { ...held } });
            refills.push(tick + REFILL_DELAY_TICKS);
          }
        } else {
          length = nextLength;
          if (length === edge) { phase = "reeling"; perfectChain = 0; }
        }
      } else {
        length = Math.max(0, length - (held ? reelSpeed(held.weight) : EMPTY_REEL_SPEED));
        if (length === 0) {
          if (held) {
            const points = pendingResult!.points;
            const bonusTicks = held.kind === "clock" ? CLOCK_BONUS_TICKS : 0;
            score += points;
            deadline = Math.min(MAX_RUN_TICKS, deadline + bonusTicks);
            grabs++;
            events.push({ type: "score", tick, item: held.id, points, bonusTicks });
            if (held.kind === "bread") {
              const index = order.remaining.indexOf(held.tier!);
              if (index >= 0) order.remaining.splice(index, 1);
              if (!order.remaining.length) {
                const reward = order.reward;
                score += reward;
                completedOrders++;
                newOrder();
                events.push({ type: "order", tick, completed: completedOrders, reward, order: cloneOrder(order) });
              }
            }
            held = null;
            pendingResult = null;
            if (score - levelStartScore >= grabLevelRules(level).target) {
              level++;
              levelStartScore = score;
              deadline = Math.min(MAX_RUN_TICKS, tick + grabLevelRules(level).duration);
              while (items.filter(i => i.kind === "bomb").length + bombRefills.length < grabLevelRules(level).bombs) {
                const bomb = spawn(true);
                items.push(bomb);
                events.push({ type: "refill", tick, item: snapshotItem(bomb), from: { x: OVEN_X, y: OVEN_Y } });
              }
              events.push({ type: "level", tick, level, target: grabLevelRules(level).target, duration: deadline - tick });
            }
          }
          phase = "idle";
          angle = swingAngle(tick);
        }
      }
    }
  };

  const validateTick = (toTick: number) => {
    if (!Number.isSafeInteger(toTick) || toTick < tick) throw new RangeError("grab: tick must be a nondecreasing safe integer");
  };
  const state = (): GrabState => {
    const tip = clawTip(angle, length);
    return {
      tick, score, over, grabs, launchesAccepted, launchesRejected,
      level, levelScore: score - levelStartScore, levelTarget: grabLevelRules(level).target, completedOrders, perfectChain,
      nextPerfectBonusPercent: Math.min(20, perfectChain * 10), order: cloneOrder(order), pendingResult: pendingResult ? { ...pendingResult } : null,
      timeLeft: deadline - tick,
      items: items.map(snapshotItem),
      claw: { phase, angle, length, ...tip, held: held ? { ...held, ...tip } : null },
      events: events.map(cloneEvent),
    };
  };
  return {
    state,
    step(toTick) {
      validateTick(toTick);
      advance(toTick);
      return events.map(cloneEvent);
    },
    launch(at) {
      validateTick(at);
      if (at <= lastLaunch) throw new RangeError("grab: launch ticks must be strictly increasing");
      lastLaunch = at;
      advance(at);
      if (over || phase !== "idle") { launchesRejected++; return false; }
      launchesAccepted++;
      phase = "extending";
      edge = fieldLength(angle);
      return true;
    },
    get score() { return score; },
    get over() { return over; },
    get grabs() { return grabs; },
    get launchesAccepted() { return launchesAccepted; },
    get launchesRejected() { return launchesRejected; },
  };
}
