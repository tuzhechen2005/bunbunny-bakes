import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), connection: async () => {} }));
import { POST as startPOST } from '@/app/api/game/td/start/route';
import { POST as finishPOST } from '@/app/api/game/td/finish/route';
import { POST as progressPOST } from '@/app/api/game/td/progress/route';
import { GET as boardGET } from '@/app/api/game/td/leaderboard/route';
import { startTdRun, finishTdRun, getTdLeaderboard, TD_MAX_FINISH_BODY_BYTES } from '@/server/td';
import { progressRun } from '@/server/gameProgress';
import { getBoard, gameOfRequest } from '@/server/gameAdmin';
import { getGameHub } from '@/server/gameHub';
import { overridePrizeGame } from '@/server/gamePrize';
import { nextGameLevel } from '@/server/gameLevels';
import { prisma } from '@/server/db';
import { replayTd, tdLevel } from '@/lib/td';
import { copy } from '@/copy';
import { greedyTd } from '../support/tdBot';
import { jsonRequest, getRequest } from './api.helpers';
import { db, resetDb } from './helpers';
const T = new Date('2026-10-20T12:00:00Z'), LATER = new Date(+T + 300_000), WEEK = '2026-10-19';
const start = (wechatId = 'alice', level?: number, now = T) => startTdRun(db,{wechatId,nickname:wechatId.trim().slice(0,10),level},'ip',now);
const win = greedyTd(tdLevel(WEEK,1));
const finish = (r: Awaited<ReturnType<typeof start>>, now = LATER) => finishTdRun(db,{runId:r.runId,inputs:win.inputs,endTick:win.state.tick},'ip',now);
beforeEach(async () => { await resetDb(); process.env.IP_HASH_SECRET = 'test-secret'; });
afterEach(() => {vi.useRealTimers();vi.unstubAllEnvs();});
afterAll(async () => {await db.$disconnect();await prisma.$disconnect();});
it('migrates TD without changing BIG defaults; deals common levels, gates case-insensitive identity and resets weekly', async () => {
  const legacy = await db.gameRun.create({data:{seed:'old',wechatId:'old',nickname:'old',tiersSnapshot:[]}});
  expect(legacy.game).toBe('BIG');
  const a = await start(' alice '), b = await start('bob');
  expect(a.seed).toBe(b.seed); expect(a.seed).toBe(tdLevel(WEEK,1).seed);
  await expect(start('ALICE',2)).rejects.toMatchObject({message:copy.gameApi.levelLocked});
  expect(await finish(a)).toMatchObject({passed:true,level:1,best:1,rank:1,personalBest:1});
  expect((await start('ALICE')).level).toBe(2);
  await expect(start('bob',2)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(start('alice',3)).rejects.toMatchObject({code:'VALIDATION'});
  expect((await start('alice',1)).seed).toBe(a.seed);
  expect((await start('alice',undefined,new Date('2026-10-26T05:00:00Z'))).level).toBe(1);
});
it('replays terminal losses, rejects incomplete/forged/tail evidence, and claims concurrent finishes once', async () => {
  const r = await start();
  await expect(finishTdRun(db,{runId:r.runId,inputs:[],endTick:0,passed:true},'ip',LATER)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(finishTdRun(db,{runId:r.runId,inputs:win.inputs,endTick:win.state.tick+1},'ip',LATER)).rejects.toMatchObject({code:'VALIDATION'});
  const [a,b] = await Promise.all([finish(r),finish(r)]);expect(a).toEqual(b);
  expect(await finish(r,new Date(+LATER+10000))).toEqual(a);
  const row = await db.gameRun.findUniqueOrThrow({where:{id:r.runId}});
  expect(row).toMatchObject({game:'TD',level:1,passedAt:LATER,finishedAt:LATER,drops:win.inputs});
  const failed = await start('bob'), loss = replayTd({seed:failed.seed,tierCount:failed.tiers.length},[]);
  expect(loss.passed).toBe(false);
  const result = await finishTdRun(db,{runId:failed.runId,inputs:[],endTick:loss.tick,score:999,passed:true},'ip',LATER);
  expect(result).toMatchObject({passed:false,best:0,rank:null});
  expect((await start('bob')).level).toBe(1);
});
it('progress is replayed, preserves prefixes/time, never passes a level, and reports live activity on a previous pass', async () => {
  const first = await start(); await finish(first);
  const r = await start('ALICE',2), inputs = [{tick:0,type:'place',slot:0,tower:'oven'}];
  const at = new Date(+LATER+10000);
  await progressRun(db,'TD',{runId:r.runId,log:inputs,endTick:60},LATER);
  expect(await nextGameLevel(db,'TD',WEEK,'alice')).toBe(2);
  expect((await getTdLeaderboard(db,LATER)).top[0]).toMatchObject({score:1,live:true});
  expect((await getGameHub(db,LATER)).games.find(g=>g.kind==='TD')).toMatchObject({weekBest:1,live:true});
  await expect(progressRun(db,'TD',{runId:r.runId,log:[],endTick:120},at)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(progressRun(db,'TD',{runId:r.runId,log:inputs,endTick:1},new Date(+at+10000))).rejects.toMatchObject({code:'VALIDATION'});
  const bad = await start('bad');
  await expect(finish(bad,T)).rejects.toMatchObject({code:'VALIDATION'});
});
it('ranks passed level then earliest server pass, shares bans, and supports admin TD and prize gates', async () => {
  const a = await start(), b = await start('bob');await finish(b,LATER);await finish(a,new Date(+LATER+1000));
  expect((await getTdLeaderboard(db,LATER)).top.map(r=>r.nickname)).toEqual(['bob','alice']);
  expect(gameOfRequest(getRequest('/api/admin/game/leaderboard?game=td'))).toBe('TD');
  expect((await getBoard(db,WEEK,LATER,'TD')).rows.map(r=>r.score)).toEqual([1,1]);
  await db.gameBan.create({data:{wechatId:'BOB'}});
  expect((await getTdLeaderboard(db,LATER)).top.map(r=>r.nickname)).toEqual(['alice']);
  await expect(start('bob')).rejects.toMatchObject({message:copy.gameApi.banned});
  const c = await start('carl'); await db.gameBan.create({data:{wechatId:'CARL'}});
  await expect(finish(c)).rejects.toMatchObject({message:copy.gameApi.banned});
  await expect(overridePrizeGame(db,'TD',T)).rejects.toMatchObject({message:copy.customer.td.prizeNotReady});
  expect(await overridePrizeGame(db,'TD',new Date('2026-12-07T12:00:00Z'))).toMatchObject({game:'TD'});
});
it('snapshots owner photos in price order and replays independently of subsequent edits', async () => {
  for (const [name, price] of [['expensive',900],['cheap',100]] as const) {
    const product = await db.product.create({data:{name,unitPriceCents:price,capacityMode:'INDEPENDENT',dailyLimit:10,imageUrl:`/photo-${name}.webp`}});
    await db.gameTier.create({data:{productId:product.id,sortOrder:price === 900 ? 0 : 1}});
  }
  const r = await start();expect(r.tiers.map(t=>t.name)).toEqual(['cheap','expensive']);
  expect(r.tiers.map(t=>t.imageUrl)).toEqual(['/photo-cheap.webp','/photo-expensive.webp']);
  await db.gameTier.deleteMany();await db.product.deleteMany();
  expect(await finish(r)).toMatchObject({passed:true});
});
it('routes expose masked boards, enforce body limits/versions/expiry and allow disabling progress', async () => {
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(T);
  const res = await startPOST(jsonRequest('/api/game/td/start',{wechatId:'wx_route',nickname:'Route'}));
  expect(res.status).toBe(201);expect(res.headers.get('cache-control')).toBe('no-store');
  const r = await res.json();vi.setSystemTime(LATER);
  const done = await finishPOST(jsonRequest('/api/game/td/finish',{runId:r.runId,inputs:win.inputs,endTick:win.state.tick}));
  expect(done.status).toBe(200);
  const board = await (await boardGET(getRequest('/api/game/td/leaderboard?wechatId=WX_ROUTE'))).json();
  expect(board).toMatchObject({nextLevel:2,myBest:1,top:[{score:1,wechatMasked:'wx***te'}]});
  expect((await finishPOST(jsonRequest('/api/game/td/finish',{padding:'x'.repeat(TD_MAX_FINISH_BODY_BYTES)}))).status).toBe(422);
  const bad = await start('old');await db.gameRun.update({where:{id:bad.runId},data:{seed:'v6.td.2026-10-19.1'}});
  await expect(finish(bad)).rejects.toMatchObject({message:copy.gameApi.runExpired});
  await expect(progressRun(db,'TD',{runId:bad.runId,log:[],endTick:60},LATER)).rejects.toMatchObject({message:copy.gameApi.runExpired});
  const expired = await start('expired');await expect(finish(expired,new Date('2026-10-26T05:00:00Z'))).rejects.toMatchObject({message:copy.gameApi.runExpired});
  vi.stubEnv('LIVE_SCORES','off');expect((await progressPOST(jsonRequest('/api/game/td/progress',{}))).status).toBe(404);
});
it('flags suspicious evidence for review without excluding a verified pass', async () => {
  const r = await start();
  const inputs = [...Array.from({length:100},()=>({tick:0,type:'sell',slot:6})),...win.inputs];
  const result = await finishTdRun(db,{runId:r.runId,inputs,endTick:win.state.tick},'ip',LATER);
  expect(result).toMatchObject({passed:true,rank:1});
  expect(await db.gameRun.findUniqueOrThrow({where:{id:r.runId}})).toMatchObject({suspicious:true});
});

it('validates and persists branch choices in server replay', async () => {
  const r = await start('branch');
  expect(win.inputs.some(i => i.type === 'upgrade' && i.branch)).toBe(true);
  const malformed = win.inputs.map(i => i.type === 'upgrade' && i.branch ? { ...i, branch: 'c' } : i);
  await expect(finishTdRun(db, { runId: r.runId, inputs: malformed, endTick: win.state.tick }, 'ip', LATER)).rejects.toMatchObject({ code: 'VALIDATION' });
  const branchIndex = win.inputs.findIndex(i => i.type === 'upgrade' && i.branch);
  const prefix = win.inputs.slice(0, branchIndex + 1);
  await progressRun(db, 'TD', { runId: r.runId, log: prefix, endTick: prefix.at(-1)!.tick }, LATER);
  expect(await finish(r)).toMatchObject({ passed: true });
  expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).drops).toEqual(win.inputs);
});

it('accepts 3x wall time, including its exact slack boundary, but rejects faster evidence', async () => {
  const playMs = Math.ceil(win.state.tick * 1000 / 60);
  const fastest = Math.ceil(playMs / 3 - 10_000);
  const accepted = await start('three');
  expect(await finish(accepted, new Date(+T + fastest))).toMatchObject({ passed: true });
  const rejected = await start('too_fast');
  await expect(finish(rejected, new Date(+T + fastest - 1))).rejects.toMatchObject({ code: 'VALIDATION' });
  const progress = await start('progress_three');
  const tick = 3600;
  const inputs = win.inputs.filter(i => i.tick <= tick);
  await progressRun(db, 'TD', { runId: progress.runId, log: inputs, endTick: tick }, new Date(+T + 20_000));
});
