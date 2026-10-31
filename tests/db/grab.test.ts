import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/server", async original => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
import { POST as startPOST } from "@/app/api/game/grab/start/route";
import { POST as finishPOST } from "@/app/api/game/grab/finish/route";
import { POST as progressPOST } from "@/app/api/game/grab/progress/route";
import { GET as boardGET } from "@/app/api/game/grab/leaderboard/route";
import { prisma } from "@/server/db";
import { startGrabRun, finishGrabRun, getGrabLeaderboard, GRAB_MAX_FINISH_BODY_BYTES } from "@/server/grab";
import { startM3Run } from "@/server/m3";
import { progressRun } from "@/server/gameProgress";
import { overridePrizeGame, getPrizeWeek } from "@/server/gamePrize";
import { getGameHub } from "@/server/gameHub";
import { MAX_LAUNCHES, MAX_RUN_TICKS, replayGrab, GRAB_ENGINE_VERSION } from "@/lib/grab";
import { copy } from "@/copy";
import { greedyGrab } from "../support/grabBot";
import { db, resetDb } from "./helpers";
import { getRequest, jsonRequest, NOW } from "./api.helpers";
const T = NOW, LATER = new Date(+T + 110_000), IP = "grab-ip";
process.env.IP_HASH_SECRET = "test-secret";
beforeEach(async () => { await resetDb(); });
afterEach(() => vi.useRealTimers());
afterAll(async () => { await db.$disconnect(); await prisma.$disconnect(); });
async function tiers(n = 8) { await db.gameTier.createMany({data: Array.from({length:n}, (_,i) => ({name:`Bread ${i}`,sortOrder:i}))}); }
const start = (wechatId = "wx_grab", at = T) => startGrabRun(db,{wechatId,nickname:"Grab"},IP,at);
function play(r: Awaited<ReturnType<typeof start>>) { const b = greedyGrab(r.seed,r.tiers); return {runId:r.runId,launches:b.launches,endTick:b.ticks}; }
it("snapshots all ordered non-big tiers, pins version and replays after configuration changes", async () => {
 await tiers(); await db.gameTier.create({data:{isBig:true,sortOrder:-1}});
 const r = await start(); expect(r.tiers).toHaveLength(8); expect(r.tiers.map(t=>t.name)).toEqual(Array.from({length:8},(_,i)=>`Bread ${i}`));
 expect(r.seed).toMatch(new RegExp(`^v${GRAB_ENGINE_VERSION}\\.[a-f0-9]{32}$`)); expect((await start("wx_other")).seed).not.toBe(r.seed);
 const log=play(r); const expected=replayGrab(r.seed,r.tiers,log.launches,log.endTick);
 await db.gameTier.deleteMany();
 expect((await finishGrabRun(db,log,IP,LATER)).score).toBe(expected.score);
 const row=await db.gameRun.findUniqueOrThrow({where:{id:r.runId}}); expect(row.drops).toEqual(log.launches); expect(row.playMs).toBe(Math.round(log.endTick*1000/60));
});
it.each([0,1,2])("unavailable with %i bread tiers", async n => { await tiers(n); await expect(start()).rejects.toMatchObject({code:"VALIDATION",message:copy.gameApi.grabNotReady}); expect(await db.gameRun.count()).toBe(0); });
it("idempotent concurrent finish, shared bans and cross-game isolation", async () => {
 await tiers(); const r=await start();const log=play(r);
 const results=await Promise.all([finishGrabRun(db,log,IP,LATER),finishGrabRun(db,log,IP,LATER)]); expect(results[0]).toEqual(results[1]);
 expect(await finishGrabRun(db,{...log,launches:[]},IP,LATER)).toEqual(results[0]);
 const other=await startM3Run(db,{wechatId:"wx",nickname:"M"},IP,T);
 await expect(finishGrabRun(db,{...log,runId:other.runId},IP,LATER)).rejects.toMatchObject({code:"NOT_FOUND"});
 const banned=await start("wx_bad"); await db.gameBan.create({data:{wechatId:"WX_BAD"}});
 await expect(finishGrabRun(db,play(banned),IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 await expect(start("wx_bad")).rejects.toMatchObject({code:"VALIDATION"});
});
it("rejects bad replay logs, observation ticks, too many ignored launches and impossible active time", async () => {
 await tiers(); const r=await start();
 for(const launches of [[1,1],[2,1],[-1],[1.2],[MAX_RUN_TICKS+1],Array.from({length:MAX_LAUNCHES+1},()=>0),Array.from({length:150},(_,i)=>i)]) {
  await expect(finishGrabRun(db,{runId:r.runId,launches,endTick:3600},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 }
 for(const body of [{launches:[100],endTick:99},{launches:[],endTick:6000},{launches:[],endTick:0.5}]) await expect(finishGrabRun(db,{runId:r.runId,...body},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 await expect(finishGrabRun(db,{runId:r.runId,launches:[],endTick:3600},IP,T)).rejects.toMatchObject({code:"VALIDATION"});
});
it("expires on weekly reset and engine version mismatch for finish and progress", async () => {
 await tiers(); const r=await start();
 await expect(finishGrabRun(db,play(r),IP,new Date(r.expiresAt))).rejects.toMatchObject({message:copy.gameApi.runExpired});
 await db.gameRun.update({where:{id:r.runId},data:{seed:"v999.abcdef"}});
 await expect(finishGrabRun(db,play(r),IP,LATER)).rejects.toMatchObject({message:copy.gameApi.runExpired});
 await expect(progressRun(db,"GRAB",{runId:r.runId,log:[],endTick:0},LATER)).rejects.toMatchObject({message:copy.gameApi.runExpired});
});
it("flags rapid attempts without removing score from the board", async () => {
 await tiers(); const r=await start();const launches=[0,1,2,3];
 await finishGrabRun(db,{runId:r.runId,launches,endTick:3600},IP,LATER);
 expect(await db.gameRun.findUnique({where:{id:r.runId}})).toMatchObject({suspicious:true});
 expect((await getGrabLeaderboard(db,T)).top).toHaveLength(1);
});
it("live progress uses elapsed ticks, preserves ties, rejects rollback and finalizes", async () => {
 await tiers(); const r=await start();const full=play(r);const endTick=1200;const log=full.launches.filter(t=>t<=endTick);
 const p=await progressRun(db,"GRAB",{runId:r.runId,log,endTick},new Date(+T+20_000));
 expect(p.score).toBe(replayGrab(r.seed,r.tiers,log,endTick).score);
 expect((await getGrabLeaderboard(db,new Date(+T+20_000))).top[0]).toMatchObject({score:p.score,live:true});
 const before=await db.gameRun.findUniqueOrThrow({where:{id:r.runId}});
 await expect(progressRun(db,"GRAB",{runId:r.runId,log,endTick},new Date(+T+21_000))).rejects.toMatchObject({code:"RATE_LIMITED"});
 await progressRun(db,"GRAB",{runId:r.runId,log,endTick},new Date(+T+28_000));
 expect((await db.gameRun.findUniqueOrThrow({where:{id:r.runId}})).updatedAt).toEqual(before.updatedAt);
 await expect(progressRun(db,"GRAB",{runId:r.runId,log:[],endTick:0},new Date(+T+36_000))).rejects.toMatchObject({code:"VALIDATION"});
 await expect(finishGrabRun(db,{runId:r.runId,launches:[],endTick:3600},IP,LATER)).rejects.toMatchObject({code:"VALIDATION"});
 await finishGrabRun(db,full,IP,LATER);
 expect((await getGrabLeaderboard(db,LATER)).top[0].live).toBe(false);
});
it("weekly board masks ids, groups identities, excludes hidden/banned and other games", async () => {
 const insert=(wechatId:string,score:number,extra={})=>db.gameRun.create({data:{game:"GRAB",seed:"s",tiersSnapshot:[],nickname:"N",wechatId,score,startedAt:T,finishedAt:T,weekKey:"2026-10-19",...extra}});
 await insert("wx_a",10);await insert("WX_A",20);await insert("wx_b",30,{hidden:true});await insert("wx_c",40);await insert("wx_big",100,{game:"BIG"});
 await db.gameBan.create({data:{wechatId:"WX_C"}});
 const board=await getGrabLeaderboard(db,T,"wx_a");expect(board.top.map(r=>r.score)).toEqual([20]);expect(board.myBest).toBe(20);expect(board.allTime?.score).toBe(20);
 expect(JSON.stringify(board)).not.toContain('"wechatId"');
 expect((await getGameHub(db,T)).games.map(g=>g.kind)).toEqual(["BIG","TU","M3","GRAB"]);
});
it("prize eligibility waits until launch week plus one and requires three tiers", async () => {
 await tiers(2);const after=new Date("2026-12-07T18:00:00Z");
 await expect(overridePrizeGame(db,"GRAB",after)).rejects.toMatchObject({code:"VALIDATION"});
 expect((await getPrizeWeek(db,after)).game).not.toBe("GRAB");
 await db.gameTier.create({data:{name:"Third",sortOrder:2}});
 await expect(overridePrizeGame(db,"GRAB",new Date("2026-12-06T18:00:00Z"))).rejects.toMatchObject({code:"VALIDATION"});
 expect((await overridePrizeGame(db,"GRAB",after)).game).toBe("GRAB");
});
it("routes start, progress, finish, board and body limit", async () => {
 await tiers();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(T);
 const response=await startPOST(jsonRequest("/api/game/grab/start",{wechatId:"wx_route",nickname:"R"}));expect(response.status).toBe(201);expect(response.headers.get("cache-control")).toBe("no-store");
 const r=await response.json();const log=play(r);vi.setSystemTime(LATER);
 const p=await progressPOST(jsonRequest("/api/game/grab/progress",{runId:r.runId,log:[],endTick:0}));expect(p.status).toBe(200);
 expect((await finishPOST(jsonRequest("/api/game/grab/finish",log))).status).toBe(200);
 const board=await boardGET(getRequest("/api/game/grab/leaderboard?wechatId=wx_route"));expect(board.headers.get("cache-control")).toBe("no-store");expect((await board.json()).top).toHaveLength(1);
 const huge=new Request("http://localhost/api/game/grab/finish",{method:"POST",headers:{"content-type":"application/json"},body:" ".repeat(GRAB_MAX_FINISH_BODY_BYTES+1)});
 expect((await finishPOST(huge)).status).toBe(422);
});

it("accepts a clock-extended run using only the snapshot and active duration", async () => {
 await tiers(); const r = await start();
 let extended = null;
 for (let i = 0; i < 40; i++) {
  const seed = `v1.${i.toString(16).padStart(4, "0")}`;
  const bot = greedyGrab(seed, r.tiers);
  if (bot.ticks > 3600) { extended = { seed, bot }; break; }
 }
 expect(extended).not.toBeNull();
 const { seed, bot } = extended!;
 await db.gameRun.update({ where: { id: r.runId }, data: { seed } });
 const body = { runId: r.runId, launches: bot.launches, endTick: bot.ticks };
 const result = await finishGrabRun(db, body, IP, new Date(+T + Math.round(bot.ticks * 1000 / 60)));
 expect(result.score).toBe(bot.score);
 expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).playMs).toBeGreaterThan(60_000);
});
