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
  g.input(40, "D"); g.step(50);
  expect(g.state().bread).toBe(1);
  expect(g.state().over).toBe(false);
  let falling = false;
  for (let t = 51; t <= 120; t++) {
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
  const jump = createRunGame({seed:"front"}); jump.input(12,"U"); jump.step(55);
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
  const g=createRunGame({seed:"truck"});g.input(35,"U");
  let landed = false;
  for (let tick = 36; tick <= 80; tick++) {
    g.step(tick);
    const { surface, y } = g.state().player;
    landed ||= surface === "roof" && y === 2600;
  }
  expect(g.state().over).toBe(false);
  expect(landed).toBe(true);
  const late=createRunGame({seed:"truck"});late.input(40,"U");late.step(70);
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
  const g=createRunGame({seed:"lower"});g.step(55);
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

it("requires roof support for elevated bread, including gold; magnet pulls both heights and values", () => {
  const bread = (id: number, z: number, y: number, value: 1 | 5 = 1): RunObject =>
    ({ id, lane: 1, kind: "bread", z, y, value, front: 0, back: 0, height: 0 });
  fixture.objects = [bread(1, 16000, 2600), bread(2, 20000, 2600, 5)];
  const ground = createRunGame({ seed: "no-roof" });
  ground.input(20, "U"); ground.step(60);
  expect(ground.state().bread).toBe(0);
  fixture.objects = [object("ramp", 9000), object("van", 20000, 2), bread(3, 21000, 2600), bread(4, 26000, 2600, 5)];
  const roof = createRunGame({ seed: "gold" }); roof.step(65);
  expect(roof.state().bread).toBe(6);
  expect(roof.state().score).toBe(Math.floor(roof.state().distance / 1000) + 60);
  fixture.objects = [
    { ...bread(1, 1000, 0), kind: "paper-bag" },
    { ...bread(2, 16000, 2600), lane: 0 },
    { ...bread(3, 20000, 2600, 5), lane: 2 }, bread(4, 22000, 0),
  ];
  const bag = createRunGame({ seed: "bag" }); bag.step(60);
  expect(bag.state().bread).toBe(7);
});

it("keeps truck bread attached in lazy, batched and pooled snapshots and collects it once", () => {
  fixture.objects = [object("truck", 30000, 1),
    { id: 2, lane: 1, kind: "bread", z: 33000, y: 2600, carrierId: 1, speed: TRUCK_SPEED, front: 0, back: 0, height: 0 }];
  const lazy = createRunGame({ seed: "cargo" }), live = createRunGame({ seed: "cargo", realtime: true });
  lazy.input(35, "U"); live.input(35, "U");
  for (let tick = 36; tick <= 80; tick++) {
    lazy.step(tick);
    expect(live.frame(tick)).toEqual(lazy.state());
    const cargo = lazy.state().objects.find(o => o.id === 2);
    const truck = lazy.state().objects.find(o => o.id === 1);
    if (cargo && truck) expect(cargo.z - truck.z).toBe(3000);
  }
  expect(lazy.state().bread).toBe(1);
});
