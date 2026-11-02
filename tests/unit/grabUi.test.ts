import { expect, it } from "vitest";
import { createGrabClock, elapsedTick } from "@/components/grab/grabClock";
import { parseGrabSave, GRAB_SAVE_KEY, type GrabSave } from "@/components/grab/grabSave";
import { GRAB_ENGINE_VERSION, replayGrab } from "@/lib/grab";
const tiers = Array.from({length:3},(_,i)=>({id:String(i),radius:1,points:1,imageUrl:null,color:{bg:"paper",ink:"ink"}}));
const save: GrabSave = {v:1,runId:"run",seed:`v${GRAB_ENGINE_VERSION}.abcdef`,tiers,launches:[],elapsedMs:1000,score:0,nickname:"N",expiresAt:"2099-01-01T00:00:00Z"};
it("counts only active milliseconds across pauses and resumptions",()=>{
 const clock=createGrabClock(500);expect(clock.read(100)).toBe(500);clock.resume(100);clock.resume(200);
 expect(clock.pause(1100)).toBe(1500);expect(clock.pause(9000)).toBe(1500);clock.resume(10000);
 expect(elapsedTick(clock.read(10500))).toBe(120);expect(clock.pause(10500)).toBe(2000);
});
it("versions, validates and expires saves",()=>{
 expect(GRAB_SAVE_KEY).toContain(`v${GRAB_ENGINE_VERSION}`);expect(parseGrabSave(JSON.stringify(save),0)).toEqual(save);
 for(const change of [{v:2},{seed:"v999.abc"},{seed:"v1.abcdef"},{seed:"v2.abcdef"},{seed:"v3.abcdef"},{seed:"v4.abcdef"},{elapsedMs:-1},{elapsedMs:100001},{tiers:tiers.slice(0,2)},{tiers:[tiers[0],tiers[0],tiers[1]]},{launches:[100]},{launches:[1,1]},{score:10},{expiresAt:"invalid"}]) expect(parseGrabSave(JSON.stringify({...save,...change}),0)).toBeNull();
 expect(parseGrabSave(JSON.stringify(save),Date.parse(save.expiresAt))).toBeNull();expect(parseGrabSave("{",0)).toBeNull();
});
it("restores a delivery and a completed log for finish retry",()=>{
 const launches=[60];const elapsedMs=60000; const score=replayGrab(save.seed,tiers,launches,elapsedTick(elapsedMs)).score;
 expect(parseGrabSave(JSON.stringify({...save,launches,elapsedMs,score}),0)).toMatchObject({launches,elapsedMs,score});
});

it("keeps idle and moving frames out of React until visible content changes", async () => {
 const { createGrabGame } = await import("@/lib/grab");
 const { grabPresentationKey } = await import("@/components/grab/grabPresentation");
 const game = createGrabGame({seed:save.seed,tiers});
 game.step(1); const idle = grabPresentationKey(game.state());
 game.step(30); expect(grabPresentationKey(game.state())).toBe(idle);
 game.launch(30); const extending = grabPresentationKey(game.state());
 expect(extending).not.toBe(idle);
 game.step(40); expect(grabPresentationKey(game.state())).toBe(extending);
 game.step(239); const raw = grabPresentationKey(game.state());
 game.step(240); expect(grabPresentationKey(game.state())).not.toBe(raw);
 game.step(600); const burnt = grabPresentationKey(game.state());
 game.step(601); expect(grabPresentationKey(game.state())).not.toBe(burnt);
});

it("bounds presentation updates and event batches through a clock-extended run", async () => {
 const { createGrabGame, RUN_TICKS } = await import("@/lib/grab");
 const { grabPresentationKey } = await import("@/components/grab/grabPresentation");
 const { greedyGrab } = await import("../support/grabBot");
 let seed = "";
 let run;
 for (let i = 0; i < 40; i++) {
  seed = `render${i}`; run = greedyGrab(seed, tiers);
  if (run.ticks > RUN_TICKS) break;
 }
 expect(run!.ticks).toBeGreaterThan(RUN_TICKS);
 const game = createGrabGame({seed,tiers});
 const launches = new Set(run!.launches);
 let changes = 0, previous = "";
 while (!game.over) {
  const tick = game.state().tick;
  if (launches.has(tick)) game.launch(tick);
  const events = game.step(tick + 1);
  expect(events.length).toBeLessThanOrEqual(10);
  const key = grabPresentationKey(game.state());
  if (key !== previous) changes++;
  previous = key;
 }
 expect(changes).toBeLessThan(300);
 expect(game.score).toBe(run!.score);
});
