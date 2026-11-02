import { expect, it } from "vitest";
import {
  createGrabGame, BLAST_RADIUS, BOMB_LINE_CLEARANCE, BOMB_PENALTY_TICKS,
  BOMB_RESPAWN_TICKS, EMPTY_REEL_SPEED, EXTEND_SPEED, REFILL_DELAY_TICKS,
  RUN_TICKS, type GrabItem,
} from "@/lib/grab";
import { firstContact, fieldLength, swingAngle } from "@/lib/grab/geometry";
import { chooseGrabWait, randomGrab } from "../support/grabBot";

const tiers = [{ id: "a" }, { id: "b" }, { id: "c" }];
function fixture(from = 0, accept: (victims: GrabItem[]) => boolean = () => true) {
  for (let i = 0; i < 2000; i++) {
    const game = createGrabGame({ seed: `bomb${i}`, tiers });
    game.step(from);
    const items = game.state().items;
    for (let at = from; at < from + 300; at++) {
      const angle = swingAngle(at);
      const hit = firstContact(angle, 0, fieldLength(angle), items);
      if (!hit || items[hit.index].kind !== "bomb") continue;
      const bomb = items[hit.index];
      const victims = items.filter(item => item.id !== bomb.id && (item.x - bomb.x) ** 2 + (item.y - bomb.y) ** 2 <= BLAST_RADIUS ** 2);
      if (!accept(victims)) continue;
      const contactTick = at + Math.ceil(hit.length / EXTEND_SPEED);
      if (contactTick >= RUN_TICKS) continue;
      game.launch(at);
      game.step(contactTick - 1);
      const before = game.state();
      const events = game.step(contactTick);
      return { game, before, events, contactTick };
    }
  }
  throw new Error("No reachable bomb fixture");
}

it("starts with exactly one safe, light M bomb and greedy avoids its visible ray", () => {
  for (let i = 0; i < 200; i++) {
    const game = createGrabGame({ seed: `safe${i}`, tiers });
    const state = game.state();
    const bombs = state.items.filter(item => item.kind === "bomb");
    expect(bombs).toHaveLength(1);
    expect(bombs[0]).toMatchObject({ tier: null, stage: "none", size: "M", weight: 0, age: 0 });
    expect(Math.abs(bombs[0].x - 360)).toBeGreaterThanOrEqual(BOMB_LINE_CLEARANCE);
    const vertical = firstContact(0, 0, fieldLength(0), state.items);
    if (vertical) expect(state.items[vertical.index].kind).not.toBe("bomb");
    const at = chooseGrabWait(state);
    const hit = firstContact(swingAngle(at), 0, fieldLength(swingAngle(at)), state.items);
    if (hit) expect(state.items[hit.index].kind).not.toBe("bomb");
    game.launch(75); // First straight-down idle launch.
    expect(game.step(160).some(e => e.type === "explode")).toBe(false);
  }
});

it("explodes at swept contact, removes exactly centres within radius, and returns empty without points or clock bonus", () => {
  const { game, before, events, contactTick } = fixture(0, victims => victims.some(item => item.kind === "clock"));
  const bomb = before.items.find(item => item.kind === "bomb")!;
  const victims = before.items.filter(item => item.kind !== "bomb" && (item.x - bomb.x) ** 2 + (item.y - bomb.y) ** 2 <= BLAST_RADIUS ** 2);
  expect(victims.length).toBeGreaterThan(0);
  const explosion = events[0];
  expect(explosion).toEqual({ type: "explode", tick: contactTick, item: { ...bomb, age: bomb.age + 1 },
    destroyed: victims.map(item => ({ ...item, age: item.age + 1 })), penaltyTicks: 300 });
  expect(events.slice(1)).toEqual(victims.map(item => ({ type: "pop", tick: contactTick, item: { ...item, age: item.age + 1 } })));
  expect(game.state().items.map(i => i.id)).toEqual(before.items.filter(i => i.id !== bomb.id && !victims.some(v => v.id === i.id)).map(i => i.id));
  expect(game.state()).toMatchObject({ score: 0, grabs: 0, timeLeft: RUN_TICKS - contactTick - BOMB_PENALTY_TICKS,
    claw: { phase: "reeling", held: null } });
  const length = game.state().claw.length;
  // Both returned events and state events are deeply detached.
  if (explosion.type !== "explode") throw new Error("Expected explosion");
  explosion.item.x = -999;
  explosion.destroyed[0].x = -999;
  const snapshot = game.state();
  const copy = snapshot.events[0];
  if (copy.type === "explode") copy.destroyed[0].x = -888;
  expect(game.state().events[0]).not.toEqual(explosion);
  expect(game.state().events[0]).not.toEqual(copy);
  game.step(contactTick + 1);
  expect(game.state().claw.length).toBe(length - EMPTY_REEL_SPEED);
  game.step(contactTick + REFILL_DELAY_TICKS - 1);
  const refills = game.step(contactTick + REFILL_DELAY_TICKS).filter(e => e.type === "refill");
  expect(refills).toHaveLength(victims.length);
  for (const event of refills) expect(event).toMatchObject({ from: { x: 680, y: 80 }, item: { age: 0 } });
  game.step(contactTick + BOMB_RESPAWN_TICKS - 1);
  expect(game.state().items.some(i => i.kind === "bomb")).toBe(false);
  const respawn = game.step(contactTick + BOMB_RESPAWN_TICKS);
  expect(respawn).toContainEqual(expect.objectContaining({ type: "refill", tick: contactTick + 300,
    from: { x: 680, y: 80 }, item: expect.objectContaining({ kind: "bomb", age: 0, size: "M" }) }));
  expect(game.state().items.filter(i => i.kind === "bomb")).toHaveLength(1);
  expect(game.state()).toMatchObject({ score: 0, grabs: 0, timeLeft: RUN_TICKS - game.state().tick - 300 });
});

it("floors the penalty to zero and emits over on the explosion tick", () => {
  const { game, events, contactTick } = fixture(3350);
  expect(events[0]).toMatchObject({ type: "explode", penaltyTicks: 300 });
  expect(events.at(-1)).toEqual({ type: "over", tick: contactTick });
  expect(game.state()).toMatchObject({ over: true, timeLeft: 0, score: 0, claw: { held: null, phase: "reeling" } });
  const frozen = game.state();
  expect(game.step(6000)).toEqual([]);
  expect({ ...game.state(), events: [] }).toEqual({ ...frozen, events: [] });
});

it("never duplicates bombs across random runs, including respawns", () => {
  let blasts = 0, respawns = 0;
  let valid = true;
  for (let i = 0; i < 30; i++) {
    const seed = `bomb-run${i}`;
    const run = randomGrab(seed, tiers);
    const game = createGrabGame({ seed, tiers });
    const launches = new Set(run.launches);
    while (!game.over) {
      const tick = game.state().tick;
      if (launches.has(tick)) game.launch(tick);
      const events = game.step(tick + 1);
      blasts += events.filter(e => e.type === "explode").length;
      respawns += events.filter(e => e.type === "refill" && e.item.kind === "bomb").length;
      const items = game.state().items;
      const bombs = items.filter(i => i.kind === "bomb");
      valid &&= bombs.length <= Math.min(3, 1 + Math.floor((game.state().level - 1) / 2));
      for (const bomb of bombs) {
        valid &&= Math.abs(bomb.x - 360) >= BOMB_LINE_CLEARANCE;
        for (const item of items) if (game.state().level === 1 && item.id !== bomb.id) {
          valid &&= (item.x - bomb.x) ** 2 + (item.y - bomb.y) ** 2 > (item.radius + bomb.radius) ** 2;
        }
      }
    }
  }
  expect(valid).toBe(true);
  expect(blasts).toBeGreaterThan(0);
  expect(respawns).toBeGreaterThan(0);
});
