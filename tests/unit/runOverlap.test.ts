import { describe, expect, it, vi } from "vitest";
import type { RunObject, RunObstacleKind } from "@/lib/run/types";
const fixture = vi.hoisted(() => ({ objects: [] as RunObject[] }));
vi.mock("@/lib/run/track", () => ({ createRunTrack: () => ({ next: () => ({ end: 100_000_000, objects: fixture.objects }) }) }));
import { createRunGame, runSpeed } from "@/lib/run/engine";
import { clearsObstacle, overlapsObstacle } from "@/lib/run/geometry";
import { replayRun } from "@/lib/run/replay";

function scenario(kind: RunObstacleKind, centreTick: number, offset: number) {
  let centre = 0;
  for(let t=1;t<=centreTick;t++) centre += runSpeed(t);
  fixture.objects = [{id:1,lane:1,z:centre,kind}];
  const game=createRunGame({seed:"geometry"});
  const dir=kind==='awning'?'D':'U';
  const at=centreTick-offset;
  game.input(at,dir);
  return { game, centre, at, dir } as const;
}

describe("continuous obstacle overlap", () => {
  it.each(['flour','puddle','awning'] as const)("%s passes through the full footprint with a centred action at base and cap speed", kind => {
    for(const centreTick of [100,7500]) {
      const {game,at,dir}=scenario(kind,centreTick,kind==='awning'?18:21);
      game.step(centreTick+20);
      expect(game.state().over).toBe(false);
      expect(replayRun('geometry',[{tick:at,dir}],centreTick+20).over).toBe(false);
    }
  });
  it.each(['flour','awning'] as const)("%s still collides after the centre has crossed when the action ends early", kind => {
    const {game,centre}=scenario(kind,100,kind==='awning'?29:34);
    game.step(100);
    expect(game.state().over).toBe(false);
    expect(game.state().objects.some(o=>o.z<=0)).toBe(true);
    game.step(112);
    expect(game.state().over).toBe(true);
    expect(game.state().distance).toBeGreaterThan(centre);
  });
  it("agrees with visible clearance for every timing offset, including near-ground first/last ticks", () => {
    for (const kind of ['flour','awning','puddle'] as const) for(const offset of [8,15,21,29,32,38,41,50]) {
      const {game,centre,at}=scenario(kind,100,offset);
      let expectedDeath: number | undefined;
      while(game.state().tick<120 && !game.state().over) {
        const before=game.state();
        const tick=before.tick+1;
        const duration=kind==='awning'?36:42;
        const age=tick-at;
        const progress=age<duration?Math.floor(age*1000/duration):0;
        if(overlapsObstacle(kind,centre-before.distance,centre-before.distance-runSpeed(tick)) &&
          !clearsObstacle(kind,age<duration?(kind==='awning'?'slide':'jump'):null,progress)) expectedDeath=tick;
        game.step(tick);
        expect(game.state().over).toBe(expectedDeath!==undefined);
      }
    }
  });
  it("a swipe after entering the front extent is too late", () => {
    expect(() => scenario('flour',100,1)).toThrow(/after game over/);
  });
  it("entering a lane midway through an overlap collides; the target lane is free before midpoint", () => {
    fixture.objects=[{id:1,lane:2,z:20_000,kind:'cart'}];
    const game=createRunGame({seed:'lane'});
    game.step(96);game.input(96,'R');
    game.step(101);expect(game.state().player.lane).toBe(1);expect(game.state().over).toBe(false);
    game.step(102);expect(game.state().player.lane).toBe(2);expect(game.state().over).toBe(true);
  });
});
