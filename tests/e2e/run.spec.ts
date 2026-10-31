// D146: mocked APIs with real RUN engine/sheets.
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { replayRun, type RunInput } from "../../src/lib/run";
import { RUN_SAVE_KEY } from "../../src/components/run/runSave";
import { perfectRun } from "../support/runBot";
const SEED="v1.abcdef0123456789", g=copy.customer.game, t=copy.customer.run;
const BOARD={liveScores:true,week:{start:"2026-12-07",end:"2026-12-13"},top:[],lastWinner:null,allTime:{nickname:"Baker",wechatMasked:"ba***er",score:9000}};
interface Log {runId:string;inputs:RunInput[];endTick:number}
async function mockApi(page:Page) {
 const starts:unknown[]=[],finishes:Log[]=[],reports:{log:RunInput[];endTick:number}[]=[];
 await page.route("**/api/menu",r=>r.fulfill({json:{products:[],ownerWechatId:"owner"}}));
 await page.route("**/api/game/hub",r=>r.fulfill({json:{liveScores:true,week:BOARD.week,prizeGame:"RUN",games:[
  {kind:"BIG",name:g.title,href:"/game",weekBest:1},{kind:"TU",name:copy.customer.tu.title,href:"/game/tu",weekBest:2},
  {kind:"M3",name:copy.customer.m3.title,href:"/game/m3",weekBest:3},{kind:"GRAB",name:copy.customer.grab.title,href:"/game/grab",weekBest:4},
  {kind:"RUN",name:t.title,href:"/game/run",weekBest:null},
 ]}}));
 await page.route("**/api/game/run/leaderboard**",r=>r.fulfill({json:BOARD}));
 await page.route("**/api/game/run/start",r=>{starts.push(r.request().postDataJSON());return r.fulfill({json:{runId:`run-${starts.length}`,seed:SEED,expiresAt:"2099-01-01T00:00:00Z"}});});
 await page.route("**/api/game/run/progress",r=>{const b=r.request().postDataJSON();reports.push(b);return r.fulfill({json:{score:replayRun(SEED,b.log,b.endTick).score,live:true}});});
 await page.route("**/api/game/run/finish",r=>{const b=r.request().postDataJSON();finishes.push(b);const score=replayRun(SEED,b.inputs,b.endTick).score;return r.fulfill({json:{score,best:score,rank:1,week:BOARD.week,personalBest:score,newRecord:true}});});
 return {starts,finishes,reports};
}
async function start(page:Page) {
 await page.getByTestId("run-menu-start").click();await page.getByTestId("run-wechat").fill("runner");await page.getByTestId("run-nickname").fill("Baker");await page.getByTestId("run-start").click();
 await expect(page.getByTestId("run-board")).toBeVisible();
}
async function swipeLeft(page:Page) {
 const board=page.getByTestId("run-board");
 await board.dispatchEvent("touchstart",{changedTouches:[{identifier:1,clientX:180,clientY:200}]});
 await board.dispatchEvent("touchmove",{changedTouches:[{identifier:1,clientX:140,clientY:204}]});
 // Later movement in this gesture must not cause another swipe.
 await board.dispatchEvent("touchmove",{changedTouches:[{identifier:1,clientX:100,clientY:80}]});
 await board.dispatchEvent("touchend",{changedTouches:[{identifier:1,clientX:100,clientY:80}]});
}
for(const width of [320,390])test.describe(`RUN ${width}px`,()=>{
 test.use({viewport:{width,height:800},hasTouch:true});
 test("five-game hub with compact full-width runner, menu, prize line and leaderboard",async({page})=>{
  await mockApi(page);await page.goto("/game/hub");
  const runner=page.getByTestId("hub-game-run");
  await expect(runner.getByTestId("hub-prize")).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const boxes=await Promise.all(["big","tu","m3","grab","run"].map(k=>page.getByTestId(`hub-game-${k}`).boundingBox()));
  expect(boxes[0]!.y).toBe(boxes[1]!.y);expect(boxes[2]!.y).toBe(boxes[3]!.y);expect(boxes[4]!.y).toBeGreaterThan(boxes[3]!.y);expect(boxes[4]!.width).toBeGreaterThan(boxes[0]!.width*2);
  expect(boxes[4]!.height).toBeGreaterThanOrEqual(boxes[0]!.height*.4);
  expect(boxes[4]!.height).toBeLessThanOrEqual(boxes[0]!.height*.6);
  const icon=runner.locator("img");
  await expect(icon).toHaveAttribute("src","/brand/run.svg");
  await expect(icon).toHaveJSProperty("naturalWidth",56);
  const iconBox=(await icon.boundingBox())!,titleBox=(await runner.getByRole("heading").boundingBox())!,bestBox=(await runner.getByTestId("hub-best").boundingBox())!;
  expect(titleBox.x).toBeGreaterThan(iconBox.x+iconBox.width);
  expect(bestBox.x).toBe(titleBox.x);expect(bestBox.y).toBeGreaterThanOrEqual(titleBox.y+titleBox.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await runner.click();await expect(page.getByRole("heading",{level:1})).toHaveText(t.title);
  await expect(page.getByTestId("run-prize-line")).toHaveText(g.prizeLine);expect(await page.locator("canvas").count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByTestId("run-open-board").click();await expect(page.getByTestId("game-all-time")).toContainText("9000");await page.getByTestId("run-board-close").click();
 });
 test("start, one swipe changes lane, collision verifies once and opens result sheet",async({page})=>{
  const api=await mockApi(page);await page.clock.install();await page.goto("/game/run");await start(page);await page.clock.runFor(100);
  await expect(page.getByTestId("run-board")).toHaveAttribute("data-lane","1");await swipeLeft(page);await page.clock.runFor(250);
  await expect(page.getByTestId("run-board")).toHaveAttribute("data-lane","0");
  const save=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),RUN_SAVE_KEY);expect(save.inputs).toHaveLength(1);expect(save.inputs[0].dir).toBe("L");
  await page.clock.runFor(40000);await expect(page.getByTestId("run-over-sheet")).toBeVisible();await expect(page.getByTestId("run-confirmed")).toContainText(g.confirmed);
  expect(api.starts).toEqual([{wechatId:"runner",nickname:"Baker"}]);expect(api.finishes).toHaveLength(1);
  expect(replayRun(SEED,api.finishes[0].inputs,api.finishes[0].endTick).over).toBe(true);
  await expect(page.getByTestId("run-new-record")).toHaveText(g.newRecord);
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),RUN_SAVE_KEY)).toBeNull();
  const tick=await page.getByTestId("run-board").getAttribute("data-tick");await page.clock.runFor(5000);await expect(page.getByTestId("run-board")).toHaveAttribute("data-tick",tick!);
  await page.getByTestId("run-over-close").click();await page.clock.runFor(1000);await expect(page.getByTestId("run-bar")).toBeVisible();
 });
 test("save/resume, keyboard, paused exit, hidden clock, discard and reduced motion",async({page})=>{
  const api=await mockApi(page);await page.emulateMedia({reducedMotion:"reduce"});await page.clock.install();await page.goto("/game/run");await start(page);await page.clock.runFor(100);
  await page.keyboard.press("ArrowRight");await page.clock.runFor(250);await expect(page.getByTestId("run-board")).toHaveAttribute("data-lane","2");
  await page.getByTestId("run-exit").click();await page.clock.runFor(100);await expect(page.getByTestId("run-exit-sheet")).toBeVisible();
  const tick=await page.getByTestId("run-board").getAttribute("data-tick");await page.clock.runFor(5000);await expect(page.getByTestId("run-board")).toHaveAttribute("data-tick",tick!);
  await page.getByTestId("run-exit-save").click();await page.clock.runFor(1000);await expect(page.getByTestId("run-resume")).toBeVisible();await page.reload();await page.getByTestId("run-resume").click();await expect(page.getByTestId("run-board")).toBeVisible();expect(api.starts).toHaveLength(1);
  await page.clock.runFor(100);await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
  const hidden=await page.getByTestId("run-board").getAttribute("data-tick");await page.clock.runFor(10000);await expect(page.getByTestId("run-board")).toHaveAttribute("data-tick",hidden!);
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});await page.clock.runFor(250);
  expect(Number(await page.getByTestId("run-board").getAttribute("data-tick"))).toBeGreaterThan(Number(hidden));
  await page.getByTestId("top-bar-back").click();await expect(page.getByTestId("run-exit-sheet")).toBeVisible();await page.getByTestId("run-exit-discard").click();await page.clock.runFor(1000);
  await expect(page.getByTestId("run-menu-start")).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),RUN_SAVE_KEY)).toBeNull();
 });
 test("resumed prefix reports live progress and failed completed save retries the same run",async({page})=>{
  const api=await mockApi(page),bot=perfectRun(SEED,1800);
  await page.addInitScript(({key,save})=>{if(!sessionStorage.getItem("seeded")){localStorage.setItem(key,JSON.stringify(save));sessionStorage.setItem("seeded","1");}},{key:RUN_SAVE_KEY,save:{v:1,runId:"saved-run",seed:SEED,inputs:bot.inputs,elapsedMs:bot.endTick*1000/60,score:bot.state.score,nickname:"Baker",expiresAt:"2099-01-01T00:00:00Z"}});
  await page.route("**/api/game/run/finish",r=>r.fulfill({status:503,json:{error:"INTERNAL",message:g.submitFailed}}));
  await page.clock.install();await page.goto("/game/run");await page.getByTestId("run-resume").click();await expect(page.getByTestId("run-board")).toBeVisible();await page.clock.runFor(100);
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
  await page.clock.runFor(11000);await expect.poll(()=>api.reports.length).toBeGreaterThan(0);
  expect(api.reports[0].endTick).toBeGreaterThanOrEqual(bot.endTick);
  await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});
  await page.clock.runFor(50000);
  await expect(page.getByTestId("run-retry")).toBeVisible();expect(api.starts).toHaveLength(0);
  const completed=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),RUN_SAVE_KEY);expect(replayRun(SEED,completed.inputs,Math.round(completed.elapsedMs*60/1000)).over).toBe(true);
  // Restore normal finish handler; the completed local log survives a reload.
  await page.unroute("**/api/game/run/finish");
  await page.route("**/api/game/run/finish",r=>{const b=r.request().postDataJSON();api.finishes.push(b);const score=replayRun(SEED,b.inputs,b.endTick).score;return r.fulfill({json:{score,best:score,rank:1,week:BOARD.week}});});
  await page.reload();await page.getByTestId("run-resume").click();await expect(page.getByTestId("run-board")).toBeVisible();await page.clock.runFor(1000);await expect(page.getByTestId("run-confirmed")).toContainText(g.confirmed);expect(api.finishes[0].runId).toBe("saved-run");
 });
});
