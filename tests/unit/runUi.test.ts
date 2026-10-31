import { expect, it } from "vitest";
import { swipeDirection, project } from "@/components/run/runHelpers";
import { createRunClock, elapsedTick } from "@/components/run/runClock";
import { parseRunSave, type RunSave } from "@/components/run/runSave";
import { replayRun } from "@/lib/run";
it("decides a swipe on its first significant move", () => {
  expect(swipeDirection(3, 4)).toBeNull();
  expect(swipeDirection(-20, 8)).toBe("L");
  expect(swipeDirection(20, -8)).toBe("R");
  expect(swipeDirection(2, -20)).toBe("U");
  expect(swipeDirection(2, 20)).toBe("D");
});
it("projects lanes symmetrically with decreasing size and height in depth", () => {
  for (const width of [320,390]) {
    const left = project(0, 0, width, 600), right = project(2, 0, width, 600);
    expect(left.x + right.x).toBe(width);
    expect(project(1, 90000, width, 600).x).toBe(width / 2);
    expect(project(1, 90000, width, 600).scale).toBeLessThan(left.scale);
    expect(project(1, 90000, width, 600).y).toBeLessThan(left.y);
    expect(project(0, -100, width, 600)).toEqual(left);
  }
});
it("excludes paused wall time", () => {
  const c = createRunClock(500); c.resume(100); c.resume(200);
  expect(c.pause(1100)).toBe(1500); expect(c.read(10000)).toBe(1500);
  c.resume(10000); expect(elapsedTick(c.read(10500))).toBe(120);
});
it("replay-validates active and completed saves, expiry and canonical terminal time", () => {
  const seed="v1.abcdef", outcome=replayRun(seed,[],54000);
  const save: RunSave={v:1,runId:"run",seed,inputs:[],elapsedMs:outcome.endTick*1000/60,score:outcome.score,nickname:"N",expiresAt:"2099-01-01T00:00:00Z"};
  expect(parseRunSave(JSON.stringify(save),0)).toEqual(save);
  for(const change of [{v:2},{seed:"v999.abc"},{elapsedMs:-1},{elapsedMs:900001},{elapsedMs:900000},{inputs:[{tick:1,dir:"Q"}]},{inputs:[{tick:1,dir:"L"},{tick:1,dir:"R"}]},{score:-1},{expiresAt:"invalid"}]) expect(parseRunSave(JSON.stringify({...save,...change}),0)).toBeNull();
  expect(parseRunSave(JSON.stringify(save),Date.parse(save.expiresAt))).toBeNull();
  expect(parseRunSave("{",0)).toBeNull();
  expect(parseRunSave(JSON.stringify({...save,elapsedMs:0,score:0}),0)).not.toBeNull();
});
