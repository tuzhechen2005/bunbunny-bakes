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
 for(const change of [{v:2},{seed:"v999.abc"},{seed:"v1.abcdef"},{elapsedMs:-1},{elapsedMs:100001},{tiers:tiers.slice(0,2)},{tiers:[tiers[0],tiers[0],tiers[1]]},{launches:[100]},{launches:[1,1]},{score:10},{expiresAt:"invalid"}]) expect(parseGrabSave(JSON.stringify({...save,...change}),0)).toBeNull();
 expect(parseGrabSave(JSON.stringify(save),Date.parse(save.expiresAt))).toBeNull();expect(parseGrabSave("{",0)).toBeNull();
});
it("restores a delivery and a completed log for finish retry",()=>{
 const launches=[60];const elapsedMs=60000; const score=replayGrab(save.seed,tiers,launches,elapsedTick(elapsedMs)).score;
 expect(parseGrabSave(JSON.stringify({...save,launches,elapsedMs,score}),0)).toMatchObject({launches,elapsedMs,score});
});
