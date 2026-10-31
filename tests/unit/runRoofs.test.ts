import { expect, it, vi } from "vitest";
import type { RunObject } from "@/lib/run";
import { runGeometry, TRUCK_SPEED } from "@/lib/run/geometry";
const fixture = vi.hoisted(() => ({ objects: [] as RunObject[] }));
vi.mock("@/lib/run/track", () => ({ createRunTrack: () => ({ next: () => ({ end: 100_000_000, objects: fixture.objects }) }) }));
import { createRunGame, runSpeed } from "@/lib/run/engine";
function object(kind: "van" | "truck" | "ramp", z: number, id = 1): RunObject {
  return { id, lane: 1, z, kind, ...runGeometry.obstacles[kind], ...(kind === "truck" ? { speed: TRUCK_SPEED } : {}) };
}
function rampRun() {
  fixture.objects = [object("ramp", 9000), object("van", 20000, 2),
    { id: 3, lane: 1, kind: "bread", z: 21000, front: 0, back: 0, height: 0, y: 2600 }];
  return createRunGame({ seed: "roof" });
}
it("walks a 4m ramp onto a roof, slides, collects roof bread, then falls with integer gravity", () => {
  const g = rampRun();
  g.step(40);
  expect(g.state().player).toMatchObject({ y: 2600, surface: "roof" });
  g.input(40, "D"); g.step(78);
  expect(g.state().bread).toBe(1);
  expect(g.state().over).toBe(false);
  let falling = false;
  for (let t = 79; t <= 120; t++) {
    g.step(t);
    const { y, surface } = g.state().player;
    expect(Number.isInteger(y)).toBe(true);
    if (y > 0 && y < 2600 && surface === "ground") falling = true;
  }
  expect(falling).toBe(true);
  expect(g.state().player.y).toBe(0);
});
it("crashes on a van front at ground level but a timed jump lands on its roof", () => {
  fixture.objects = [object("van", 20000)];
  const crash = createRunGame({seed:"front"}); crash.step(100);
  expect(crash.state().over).toBe(true);
  const jump = createRunGame({seed:"front"}); jump.input(19,"U"); jump.step(55);
  expect(jump.state().over).toBe(false);
  expect(jump.state().player).toMatchObject({surface:"roof",y:2600});
});
it("moves trucks by player speed plus TRUCK_SPEED every tick, with batch/live parity", () => {
  fixture.objects = [object("truck", 40000)];
  const a=createRunGame({seed:"truck"}), b=createRunGame({seed:"truck",realtime:true});
  let expected=40000;
  for(let t=1;t<=30;t++) {
    expected-=runSpeed(t)+TRUCK_SPEED;
    a.step(t); expect(a.state().objects[0].z).toBe(expected);
    expect(b.frame(t)).toEqual(a.state());
  }
  const c=createRunGame({seed:"truck"});c.step(30);expect(c.state()).toEqual(a.state());
});
it("can land on a moving truck and rejects a late jump at its front", () => {
  fixture.objects = [object("truck",30000)];
  const g=createRunGame({seed:"truck"});g.input(50,"U");g.step(85);
  expect(g.state().over).toBe(false);
  expect(g.state().player).toMatchObject({surface:"roof",y:2600});
  const late=createRunGame({seed:"truck"});late.input(65,"U");late.step(85);
  expect(late.state().over).toBe(true);
});
it("ground obstacles cannot hit feet above their height; a roof lane exit falls", () => {
  const g=rampRun();g.step(50);g.input(50,"L");g.step(56);
  expect(g.state().player.surface).toBe("ground");
  expect(g.state().player.y).toBeLessThan(2600);
  g.step(80);expect(g.state().player.y).toBe(0);
});

it("never clips the rear face while stepping off a roof at any tick alignment", () => {
  for (let offset = 0; offset < 750; offset += 25) {
    fixture.objects = [object("ramp", 9000 + offset), object("van", 20000 + offset, 2)];
    const g=createRunGame({seed:"edge"});g.step(130);
    expect(g.state().over, `offset ${offset}`).toBe(false);
    expect(g.state().player.y).toBe(0);
  }
});
it("ignores a ground flour stack below an occupied roof", () => {
  fixture.objects = [object("ramp",9000), object("van",20000,2),
    {id:3,lane:1,z:21000,kind:"flour",...runGeometry.obstacles.flour}];
  const g=createRunGame({seed:"lower"});g.step(80);
  expect(g.state().over).toBe(false);
  expect(g.state().player.y).toBe(2600);
});
it("activates distant trucks identically in lazy and pre-generated tracks", () => {
  fixture.objects = [object("truck", 200000)];
  const lazy=createRunGame({seed:"distant"}), live=createRunGame({seed:"distant",realtime:true});
  lazy.input(0,"L");live.input(0,"L");
  for (const tick of [100, 300, 400, 500, 600]) {
    lazy.step(tick);
    expect(live.frame(tick)).toEqual(lazy.state());
  }
});

it("a fast ramp catches a low jump instead of letting feet pass through its slope", () => {
  let distance=0;
  for(let t=1;t<=4500;t++) distance+=runSpeed(t);
  fixture.objects=[object("ramp",distance+2000),object("van",distance+13000,2)];
  const g=createRunGame({seed:"fast-ramp"});g.input(4500,"U");g.step(4510);
  expect(g.state().over).toBe(false);
  expect(g.state().player).toMatchObject({surface:"roof",y:2600});
});
