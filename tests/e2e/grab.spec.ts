// G2/G3: mocked HTTP with the real deterministic engine.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createGrabGame, replayGrab, GRAB_ENGINE_VERSION, FIELD_WIDTH, FIELD_HEIGHT, TICKS_PER_SECOND } from "../../src/lib/grab";
test.use({ browserName: "chromium" });
import { GRAB_SAVE_KEY } from "../../src/components/grab/grabSave";
import { greedyGrab } from "../support/grabBot";
import { aimGrabBread } from "../support/grabAim";

const SEED = `v${GRAB_ENGINE_VERSION}.abcdef0123456789`;
const TIERS = Array.from({length:6},(_,i)=>({id:`t${i}`,name:`Bread ${i}`,radius:.1,points:10,imageUrl:`/api/images/mock/grab-${i}.jpg`,color:{bg:"#EFE7DA",ink:"#4A2723"}}));
const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const BOARD = {liveScores:true,week:{start:"2026-12-07",end:"2026-12-13"},top:[],lastWinner:null,allTime:{nickname:"Baker",wechatMasked:"ba***er",score:9000}};
const g = copy.customer.game, t = copy.customer.grab;
interface Log {runId:string;launches:number[];endTick:number}
async function mockApi(page: Page, prize = "GRAB") {
 const starts: unknown[] = [], finishes: Log[] = [], reports: {log:number[];endTick:number}[] = [];
 await page.route("**/api/menu", r=>r.fulfill({json:{products:[],ownerWechatId:"owner"}}));
 await page.route(/\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/, r=>r.fulfill({body:PHOTO,contentType:"image/jpeg"}));
 await page.route("**/api/game/hub",r=>r.fulfill({json:{liveScores:true,week:BOARD.week,prizeGame:prize,games:[
  {kind:"BIG",name:g.title,href:"/game",weekBest:1},{kind:"TU",name:copy.customer.tu.title,href:"/game/tu",weekBest:2},
  {kind:"M3",name:copy.customer.m3.title,href:"/game/m3",weekBest:3},{kind:"GRAB",name:t.title,href:"/game/grab",weekBest:null},
 ]}}));
 await page.route("**/api/game/grab/leaderboard**",r=>r.fulfill({json:BOARD}));
 await page.route("**/api/game/grab/start",r=>{ starts.push(r.request().postDataJSON());return r.fulfill({json:{runId:`grab-run-${starts.length}`,seed:SEED,tiers:TIERS,expiresAt:"2099-01-01T00:00:00Z"}}); });
 await page.route("**/api/game/grab/progress",r=>{ const b=r.request().postDataJSON();reports.push(b);return r.fulfill({json:{score:replayGrab(SEED,TIERS,b.log,b.endTick).score,live:true}}); });
 await page.route("**/api/game/grab/finish",r=>{ const b=r.request().postDataJSON();finishes.push(b);const score=replayGrab(SEED,TIERS,b.launches,b.endTick).score;return r.fulfill({json:{score,best:score,rank:1,week:BOARD.week,personalBest:score,newRecord:true}}); });
 return {starts,finishes,reports};
}
async function start(page:Page) {
 await page.getByTestId("grab-menu-start").click();await page.getByTestId("grab-wechat").fill("grab_fan");await page.getByTestId("grab-nickname").fill("Baker");await page.getByTestId("grab-start").click();
 await expect(page.getByTestId("grab-board")).toBeVisible();
}
async function stored(page:Page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),GRAB_SAVE_KEY); }
for(const width of [320,390]) {
 test.describe(`GRAB ${width}px`,()=>{
  test.use({viewport:{width,height:800},hasTouch:true});
  test("four game hub, illustrated menu, prize gating and leaderboard",async({page})=>{
   await mockApi(page);await page.goto("/game/hub");
   const boxes=await Promise.all(["big","tu","m3","grab"].map(k=>page.getByTestId(`hub-game-${k}`).boundingBox()));
   expect(boxes[0]!.y).toBe(boxes[1]!.y);expect(boxes[2]!.y).toBe(boxes[3]!.y);expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
   await page.getByTestId("hub-game-grab").click();await expect(page.getByRole("heading",{level:1})).toHaveText(t.title);
   for(const art of ["tongs","bread","clock"]) await expect(page.getByTestId(`grab-help-${art}`).locator("img")).toHaveAttribute("src",`/brand/grab/${art}.svg`);
   await expect(page.getByTestId("grab-prize-line")).toHaveText(g.prizeLine);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await page.getByTestId("grab-open-board").click();await expect(page.getByTestId("game-all-time")).toContainText("9000");await page.getByTestId("grab-board-close").click();
   await page.route("**/api/game/hub",r=>r.fulfill({json:{week:BOARD.week,prizeGame:"TU",games:[]}}));await page.reload();await expect(page.getByTestId("grab-prize-line")).toHaveCount(0);
  });
  test("accepts a press before the deferred animation boot",async({page})=>{
   await mockApi(page); await page.clock.install(); await page.goto("/game/grab");
   await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
   await start(page); // The board is mounted, but its setTimeout(boot, 0) has not run.
   const box=(await page.getByTestId("grab-board").boundingBox())!;
   await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
   await expect(page.getByTestId("grab-board")).toHaveAttribute("data-phase","extending");
   await expect(page.getByTestId("grab-board")).toHaveAttribute("data-launches","1");
   expect((await stored(page)).launches).toEqual([0]);
   await page.clock.runFor(100);
   expect(Number(await page.getByTestId("grab-board").getAttribute("data-tick"))).toBeGreaterThan(0);
  });
  test("start, aimed launch, delivery, live report and final sheet",async({page})=>{
   const api=await mockApi(page);await page.clock.install();await page.goto("/game/grab");
   // runFor alone resumes real time afterwards. Freeze it before starting so test-side
   // replay/search and browser round trips cannot drift outside a narrow bread window.
   await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));await start(page);
   expect(api.starts).toEqual([{wechatId:"grab_fan",nickname:"Baker"}]);
   const box=(await page.getByTestId("grab-board").boundingBox())!;expect(box.width/box.height).toBeCloseTo(FIELD_WIDTH/FIELD_HEIGHT,1);
   expect(box.y + box.height).toBeGreaterThan(780);
   expect(box.y + box.height).toBeLessThanOrEqual(800);
   for (const [index, input] of ["touch", "mouse"].entries()) {
    await page.clock.runFor(100);
    const scoreBefore = Number(await page.getByTestId("grab-score").textContent());
    const tick = Number(await page.getByTestId("grab-board").getAttribute("data-tick"));
    const game = createGrabGame({seed:SEED,tiers:TIERS});
    (await stored(page)).launches.forEach((at:number)=>game.launch(at)); game.step(tick);
    // V2's deep field has narrower hit windows after the first delivery.
    // Use the widest window's actual margin; still send exactly one input per launch.
    const target = aimGrabBread(game.state());
    await page.clock.runFor((target.tick-tick)*1000/TICKS_PER_SECOND);
    if (input === "touch") await page.getByTestId("grab-board").tap();
    // The review used mouse.click at the field centre in a hasTouch context.
    else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await expect(page.getByTestId("grab-board")).toHaveAttribute("data-phase", "extending");
    await expect(page.getByTestId("grab-board")).toHaveAttribute("data-launches", String(index+1));
    const launches = (await stored(page)).launches as number[];
    expect(launches).toHaveLength(index+1);
    expect(Math.abs(launches[index]-target.tick)).toBeLessThanOrEqual(target.margin);
    await page.clock.runFor(100);
    const arm = await page.locator(".grab-arm-segment").boundingBox();
    expect(arm!.height).toBeGreaterThan(0);
    await page.getByTestId("grab-board").tap(); // Busy input must not cancel or enter the log.
    expect((await stored(page)).launches).toHaveLength(index+1);
    await page.clock.runFor(8000);
    await expect(page.getByTestId("grab-board")).toHaveAttribute("data-phase", "idle");
    expect(Number(await page.getByTestId("grab-score").textContent())).toBeGreaterThan(scoreBefore);
   }
   await page.clock.runFor(10000);await expect.poll(()=>api.reports.length).toBeGreaterThan(0);
   await page.clock.runFor(100000);await expect(page.getByTestId("grab-over-sheet")).toBeVisible();await expect(page.getByTestId("grab-confirmed")).toContainText(g.confirmed);
   expect(api.finishes).toHaveLength(1);expect(replayGrab(SEED,TIERS,api.finishes[0].launches,api.finishes[0].endTick).over).toBe(true);
   await expect(page.getByTestId("grab-new-record")).toHaveText(g.newRecord);
   await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),GRAB_SAVE_KEY)).toBeNull();
   const finalTick=await page.getByTestId("grab-board").getAttribute("data-tick");await page.clock.runFor(5000);await expect(page.getByTestId("grab-board")).toHaveAttribute("data-tick",finalTick!);
   await page.getByTestId("grab-over-close").click();await page.clock.runFor(1000);await expect(page.getByTestId("grab-bar")).toBeVisible();
  });
  test("save/resume, exit pauses, hidden time excluded, reduced motion",async({page})=>{
   const api=await mockApi(page);await page.emulateMedia({reducedMotion:"reduce"});await page.clock.install();await page.goto("/game/grab");await start(page);await page.clock.runFor(4300);
   await page.getByTestId("grab-exit").click();await expect(page.getByTestId("grab-exit-sheet")).toBeVisible();
   const tick=await page.getByTestId("grab-board").getAttribute("data-tick");await page.clock.runFor(5000);await expect(page.getByTestId("grab-board")).toHaveAttribute("data-tick",tick!);
   await page.getByTestId("grab-exit-save").click();await page.clock.runFor(1000);await expect(page.getByTestId("grab-resume")).toBeVisible();
   const saved=await stored(page);expect(Math.round(saved.elapsedMs*TICKS_PER_SECOND/1000)).toBe(Number(tick));await page.reload();await page.getByTestId("grab-resume").click();expect(api.starts).toHaveLength(1);
   await page.clock.runFor(100);expect(Number(await page.getByTestId("grab-board").getAttribute("data-tick"))).toBeGreaterThanOrEqual(Math.round(saved.elapsedMs*60/1000));
   await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
   const hiddenTick=await page.getByTestId("grab-board").getAttribute("data-tick");await page.clock.runFor(10000);await expect(page.getByTestId("grab-board")).toHaveAttribute("data-tick",hiddenTick!);
   await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});await page.clock.runFor(500);
   expect(Number(await page.getByTestId("grab-board").getAttribute("data-tick"))).toBeGreaterThan(Number(hiddenTick));
   await expect(page.locator(".grab-perfect").first()).toHaveCSS("animation-name","none");
   await page.getByTestId("top-bar-back").click();await expect(page.getByTestId("grab-exit-sheet")).toBeVisible();
   const backTick=await page.getByTestId("grab-board").getAttribute("data-tick");await page.clock.runFor(5000);await expect(page.getByTestId("grab-board")).toHaveAttribute("data-tick",backTick!);
   await page.getByTestId("grab-exit-discard").click();await page.clock.runFor(1000);
   await expect(page.getByTestId("grab-menu-start")).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),GRAB_SAVE_KEY)).toBeNull();
  });
  test("completed save retries finish without starting another run",async({page})=>{
   const api=await mockApi(page);const bot=greedyGrab(SEED,TIERS);
   await page.addInitScript(({key,save})=>localStorage.setItem(key,JSON.stringify(save)),{key:GRAB_SAVE_KEY,save:{v:1,runId:"saved-run",seed:SEED,tiers:TIERS,launches:bot.launches,elapsedMs:bot.ticks*1000/60,score:bot.score,nickname:"Baker",expiresAt:"2099-01-01T00:00:00Z"}});
   await page.goto("/game/grab");await page.getByTestId("grab-resume").click();await expect(page.getByTestId("grab-confirmed")).toContainText(g.confirmed);expect(api.starts).toHaveLength(0);expect(api.finishes[0].runId).toBe("saved-run");
  });
 });
}
