import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/server", async original => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
import { POST as startPOST } from "@/app/api/game/run/start/route";
import { POST as finishPOST } from "@/app/api/game/run/finish/route";
import { POST as progressPOST } from "@/app/api/game/run/progress/route";
import { GET as boardGET } from "@/app/api/game/run/leaderboard/route";
import { prisma } from "@/server/db";
import { startRun, finishRun, getRunLeaderboard, RUN_MAX_FINISH_BODY_BYTES } from "@/server/run";
import { progressRun } from "@/server/gameProgress";
import { overridePrizeGame, getPrizeWeek } from "@/server/gamePrize";
import { getGameHub } from "@/server/gameHub";
import { MAX_INPUTS, MAX_RUN_TICKS, replayRun, RUN_ENGINE_VERSION } from "@/lib/run";
import { copy } from "@/copy";
import { perfectRun } from "../support/runBot";
import { db, resetDb } from "./helpers";
import { getRequest, jsonRequest, NOW } from "./api.helpers";
const T=NOW, LATER=new Date(+T+910000), IP="run-ip";
process.env.IP_HASH_SECRET="test-secret";
beforeEach(async()=>{await resetDb();});
afterEach(()=>vi.useRealTimers());
afterAll(async()=>{await db.$disconnect();await prisma.$disconnect();});
const start=(wechatId="wx_run",at=T)=>startRun(db,{wechatId,nickname:"Runner"},IP,at);
function play(r:Awaited<ReturnType<typeof start>>,limit=1800) {const b=perfectRun(r.seed,limit);return {runId:r.runId,inputs:b.inputs,endTick:b.endTick};}
it("starts with no configured tiers, unique versioned seed and scratch replay",async()=>{
 const r=await start();expect(await db.gameTier.count()).toBe(0);
 expect(r.seed).toMatch(new RegExp(`^v${RUN_ENGINE_VERSION}\\.[a-f0-9]{32}$`));expect((await start("wx_other")).seed).not.toBe(r.seed);
 const log=play(r),expected=replayRun(r.seed,log.inputs,log.endTick);
 expect((await finishRun(db,log,IP,LATER)).score).toBe(expected.score);
 expect(await db.gameRun.findUniqueOrThrow({where:{id:r.runId}})).toMatchObject({game:"RUN",tiersSnapshot:[],drops:log.inputs,playMs:30000,dropCount:log.inputs.length});
});
it("concurrent finish is idempotent, isolates other games and enforces shared bans",async()=>{
 const r=await start(), log=play(r);
 const results=await Promise.all([finishRun(db,log,IP,LATER),finishRun(db,log,IP,LATER)]);expect(results[0]).toEqual(results[1]);
 expect(await finishRun(db,{...log,inputs:[]},IP,LATER)).toEqual(results[0]);
 const other=await start("wx_other");await db.gameRun.update({where:{id:other.runId},data:{game:"BIG"}});
 await expect(finishRun(db,{...log,runId:other.runId},IP,LATER)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(progressRun(db,"RUN",{runId:other.runId,log:[],endTick:0},LATER)).rejects.toMatchObject({code:"NOT_FOUND"});
 const banned=await start("wx_bad");await db.gameBan.create({data:{wechatId:"WX_BAD"}});
 await expect(start("wx_bad")).rejects.toMatchObject({code:"VALIDATION"});
 await expect(finishRun(db,play(banned),IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 await expect(progressRun(db,"RUN",{runId:banned.runId,log:[],endTick:0},LATER)).rejects.toMatchObject({code:"VALIDATION"});
});
it("rejects malformed and excessive logs, impossible wall time, post-crash time and cap overflow",async()=>{
 const r=await start();
 for(const inputs of [[{tick:1,dir:"Q"}],[{tick:-1,dir:"L"}],[{tick:.5,dir:"R"}],[{tick:1,dir:"L"},{tick:1,dir:"R"}],[{tick:2,dir:"L"},{tick:1,dir:"R"}],[{tick:1,dir:"L",extra:true}],Array.from({length:MAX_INPUTS+1},()=>({tick:0,dir:"U"}))]) {
  await expect(finishRun(db,{runId:r.runId,inputs,endTick:60},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 }
 for(const body of [{inputs:[{tick:100,dir:"L"}],endTick:99},{inputs:[],endTick:MAX_RUN_TICKS+1},{inputs:[],endTick:0.5},{inputs:[],endTick:MAX_RUN_TICKS}]) {
  await expect(finishRun(db,{runId:r.runId,...body},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 }
 await expect(finishRun(db,play(r),IP,T)).rejects.toMatchObject({code:"VALIDATION"});
});
it("permits pauses until expiry and rejects engine version mismatch",async()=>{
 const r=await start();await expect(finishRun(db,play(r),IP,new Date(r.expiresAt))).rejects.toMatchObject({message:copy.gameApi.runExpired});
 await expect(progressRun(db,"RUN",{runId:r.runId,log:[],endTick:0},new Date(r.expiresAt))).rejects.toMatchObject({message:copy.gameApi.runExpired});
 await db.gameRun.update({where:{id:r.runId},data:{seed:"v999.abcdef",progressAttemptAt:null}});
 await expect(finishRun(db,play(r),IP,LATER)).rejects.toMatchObject({message:copy.gameApi.runExpired});
 await expect(progressRun(db,"RUN",{runId:r.runId,log:[],endTick:0},LATER)).rejects.toMatchObject({message:copy.gameApi.runExpired});
 const paused=await start("wx_pause");expect((await finishRun(db,play(paused),IP,new Date(+T+3600000))).score).toBeGreaterThan(0);
});
it("flags rapid inputs and long runs but ranks both, including the fifteen-minute cap",async()=>{
 const r=await start();const inputs=[0,1,2,3].map(tick=>({tick,dir:"U"}));
 await finishRun(db,{runId:r.runId,inputs,endTick:60},IP,LATER);
 expect(await db.gameRun.findUnique({where:{id:r.runId}})).toMatchObject({suspicious:true});
 const long=await start("wx_long");const log=play(long,MAX_RUN_TICKS);await finishRun(db,log,IP,LATER);
 expect(await db.gameRun.findUnique({where:{id:long.runId}})).toMatchObject({suspicious:true,playMs:900000});
 expect((await getRunLeaderboard(db,T)).top).toHaveLength(2);
});
it("live progress preserves ties, enforces monotonic prefixes/time and finalizes",async()=>{
 const r=await start(),full=play(r),endTick=600,log=full.inputs.filter(i=>i.tick<=endTick);
 const p=await progressRun(db,"RUN",{runId:r.runId,log,endTick},new Date(+T+10000));
 expect(p.score).toBe(replayRun(r.seed,log,endTick).score);
 expect((await getRunLeaderboard(db,new Date(+T+10000))).top[0]).toMatchObject({score:p.score,live:true});
 const before=await db.gameRun.findUniqueOrThrow({where:{id:r.runId}});
 await expect(progressRun(db,"RUN",{runId:r.runId,log,endTick},new Date(+T+11000))).rejects.toMatchObject({code:"RATE_LIMITED"});
 await progressRun(db,"RUN",{runId:r.runId,log,endTick},new Date(+T+18000));
 expect((await db.gameRun.findUniqueOrThrow({where:{id:r.runId}})).updatedAt).toEqual(before.updatedAt);
 await expect(progressRun(db,"RUN",{runId:r.runId,log:[],endTick:0},new Date(+T+26000))).rejects.toMatchObject({code:"VALIDATION"});
 await expect(finishRun(db,{runId:r.runId,inputs:[],endTick:0},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 await finishRun(db,full,IP,LATER);expect((await getRunLeaderboard(db,LATER)).top[0].live).toBe(false);
});
it("masks ids, groups identities, excludes hidden/banned and other games; hub has five games",async()=>{
 const insert=(wechatId:string,score:number,extra={})=>db.gameRun.create({data:{game:"RUN",seed:"s",tiersSnapshot:[],nickname:"N",wechatId,score,startedAt:T,finishedAt:T,weekKey:"2026-10-19",...extra}});
 await insert("wx_a",10);await insert("WX_A",20);await insert("wx_b",30,{hidden:true});await insert("wx_c",40);await insert("wx_big",100,{game:"BIG"});await db.gameBan.create({data:{wechatId:"WX_C"}});
 const b=await getRunLeaderboard(db,T,"wx_a");expect(b.top.map(r=>r.score)).toEqual([20]);expect(b.myBest).toBe(20);expect(JSON.stringify(b)).not.toContain('"wechatId"');
 expect((await getGameHub(db,T)).games.map(g=>g.kind)).toEqual(["BIG","TU","M3","GRAB","RUN"]);
});
it("prize joins the following week without any tier prerequisite",async()=>{
 await expect(overridePrizeGame(db,"RUN",new Date("2026-12-06T18:00:00Z"))).rejects.toMatchObject({code:"VALIDATION"});
 expect((await getPrizeWeek(db,new Date("2026-12-06T18:00:00Z")))).not.toMatchObject({game:"RUN"});
 expect((await overridePrizeGame(db,"RUN",new Date("2026-12-07T18:00:00Z")))).toMatchObject({game:"RUN"});
});
it("routes start/progress/finish/leaderboard, no-store and bounded request bodies",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(T);
 const res=await startPOST(jsonRequest("/api/game/run/start",{wechatId:"wx_route",nickname:"R"}));expect(res.status).toBe(201);expect(res.headers.get("cache-control")).toBe("no-store");
 const r=await res.json();vi.setSystemTime(LATER);
 expect((await progressPOST(jsonRequest("/api/game/run/progress",{runId:r.runId,log:[],endTick:0}))).status).toBe(200);
 expect((await finishPOST(jsonRequest("/api/game/run/finish",play(r)))).status).toBe(200);
 const board=await boardGET(getRequest("/api/game/run/leaderboard?wechatId=wx_route"));expect(board.headers.get("cache-control")).toBe("no-store");expect((await board.json()).top).toHaveLength(1);
 for(const post of [finishPOST,progressPOST])expect((await post(new Request("http://localhost/api/game/run/finish",{method:"POST",headers:{"content-type":"application/json"},body:" ".repeat(RUN_MAX_FINISH_BODY_BYTES+1)}))).status).toBe(422);
});
