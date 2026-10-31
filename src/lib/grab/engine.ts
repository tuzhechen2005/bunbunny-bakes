import { createRng } from "../game/rng";
import { clawTip, fieldLength, firstContact, swingAngle } from "./geometry";
import {
  CLOCK_BONUS_TICKS, EMPTY_REEL_SPEED, EXTEND_SPEED, FIELD_ITEMS, MIN_TIERS,
  OVEN_X, OVEN_Y, REFILL_DELAY_TICKS, RUN_TICKS,
  type GrabEvent, type GrabGame, type GrabItem, type GrabKind, type GrabSize,
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
  return Math.max(2, 17 - weight * 4);
}

interface LiveItem extends Omit<GrabItem, "age" | "stage"> { born: number; slot: number }

const cloneEvent = (e: GrabEvent): GrabEvent => {
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
  let phase: GrabState["claw"]["phase"] = "idle";
  let angle = swingAngle(0), length = 0, edge = 0;
  let held: GrabItem | null = null;
  let events: GrabEvent[] = [];
  const items: LiveItem[] = [];
  const refills: number[] = [];
  let deck: GrabKind[] = [];

  const snapshotItem = (item: LiveItem): GrabItem => {
    const { id, kind, tier, size, x, y, radius, weight } = item;
    const age = tick - item.born;
    return { id, kind, tier, size, x, y, radius, weight, age, stage: kind === "bread" ? breadStage(age) : "none" };
  };

  const spawn = (): LiveItem => {
    // One clock per shuffled 32-item oven batch: rare, with bounded replay duration.
    if (!deck.length) {
      deck = [...Array<GrabKind>(23).fill("bread"), "flour", ...Array<GrabKind>(7).fill("butter"), "clock"];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    const kind = deck.pop()!;
    const size: GrabSize = kind === "bread" ? (["S", "M", "L"] as const)[rng.int(3)] : kind === "flour" ? "L" : "S";
    const tier = kind === "bread" ? rng.int(tierCount) : null;
    const free = Array.from({ length: 20 }, (_, i) => i).filter((slot) => !items.some((item) => item.slot === slot));
    const slot = free[rng.int(free.length)];
    return {
      id: nextId++, kind, tier, size, slot, born: tick,
      x: 90 + (slot % 4) * 180 + rng.int(29) - 14,
      y: 522 + Math.trunc(slot / 4) * 207 + rng.int(33) - 16,
      radius: kind === "bread" ? BREAD[size].radius : kind === "flour" ? 44 : 25,
      weight: kind === "bread" ? BREAD[size].weight : kind === "flour" ? 8 : 0,
    };
  };
  for (let i = 0; i < FIELD_ITEMS; i++) items.push(spawn());

  const advance = (toTick: number) => {
    events = [];
    while (!over && tick < toTick) {
      tick++;
      // Expiry wins ties: neither a last-tick bread nor a last-tick clock is delivered.
      if (tick >= deadline) {
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
      if (phase === "idle") angle = swingAngle(tick);
      else if (phase === "extending") {
        const nextLength = Math.min(edge, length + EXTEND_SPEED);
        const contact = firstContact(angle, length, nextLength, items);
        if (contact) {
          length = contact.length;
          const item = items.splice(contact.index, 1)[0];
          held = snapshotItem(item);
          events.push({ type: "pop", tick, item: { ...held } });
          refills.push(tick + REFILL_DELAY_TICKS);
          phase = "reeling";
        } else {
          length = nextLength;
          if (length === edge) phase = "reeling";
        }
      } else {
        length = Math.max(0, length - (held ? reelSpeed(held.weight) : EMPTY_REEL_SPEED));
        if (length === 0) {
          if (held) {
            const points = held.kind === "bread" ? breadPoints(held.size, held.age) : held.kind === "clock" ? 0 : 20;
            const bonusTicks = held.kind === "clock" ? CLOCK_BONUS_TICKS : 0;
            score += points;
            deadline += bonusTicks;
            grabs++;
            events.push({ type: "score", tick, item: held.id, points, bonusTicks });
            held = null;
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
