import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../src/copy';
import { tdLevel, replayTd, towerStats, TD_ENGINE_VERSION, type TdInput } from '../../src/lib/td';
import { greedyTd } from '../support/tdBot';
import { TD_SAVE_KEY } from '../../src/components/td/tdSave';
// File-level browser selection: never override browserName inside a describe.
test.use({ browserName: 'chromium' });
const t=copy.customer.td,g=copy.customer.game,weekKey='2026-10-19',seed=tdLevel(weekKey,1).seed;
const tiers=[{id:'bread',radius:.1,points:1,name:'Bread',imageUrl:'/brand/logo.webp',color:{bg:'white',ink:'black'}}];
const board={liveScores:true,nextLevel:1,week:{start:weekKey,end:'2026-10-25'},top:[],lastWinner:null,allTime:{nickname:'Baker',wechatMasked:'ba***er',score:3}};
async function mockApi(page:Page) {
  const starts:unknown[]=[],finishes:{runId:string;inputs:TdInput[];endTick:number}[]=[];
  await page.route('**/brand/td/manifest.json',r=>r.fulfill({status:404,body:''}));
  await page.route('**/api/game/hub',r=>r.fulfill({json:{liveScores:true,week:board.week,prizeGame:'TD',games:['BIG','TU','M3','GRAB','RUN','TD'].map((kind,i)=>({kind,name:[g.title,copy.customer.tu.title,copy.customer.m3.title,copy.customer.grab.title,copy.customer.run.title,t.title][i],href:kind==='BIG'?'/game':`/game/${kind.toLowerCase()}`,weekBest:null}))}}));
  await page.route('**/api/game/td/leaderboard**',r=>r.fulfill({json:board}));
  await page.route('**/api/game/td/start',r=>{starts.push(r.request().postDataJSON());return r.fulfill({json:{runId:`00000000-0000-4000-8000-${String(starts.length).padStart(12,'0')}`,seed,level:1,weekKey,mapData:tdLevel(weekKey,1).mapData,unlockedTowers:["rollingPin"],newlyUnlocked:["rollingPin"],tiers,expiresAt:'2099-01-01T00:00:00Z'}});});
  await page.route('**/api/game/td/progress',r=>r.fulfill({json:{score:0,live:true}}));
  await page.route('**/api/game/td/finish',r=>{const body=r.request().postDataJSON();finishes.push(body);const s=replayTd({seed,tierCount:1},body.inputs,body.endTick);return r.fulfill({json:{score:s.wave,level:1,passed:s.passed,best:Number(s.passed),personalBest:Number(s.passed),rank:s.passed?1:null,week:board.week}});});
  return {starts,finishes};
}
async function begin(page:Page) {
  await page.getByTestId('td-menu-start').click();
  await expect(page.getByTestId('td-wechat')).toHaveAttribute('placeholder',g.wechatPlaceholder);
  await expect(page.getByTestId('td-nickname')).toHaveAttribute('placeholder',g.nicknamePlaceholder);
  await page.getByTestId('td-wechat').fill('baker');await page.getByTestId('td-nickname').fill('Baker');await page.getByTestId('td-start').click();
  await expect(page.getByTestId('td-slot-0')).toBeEnabled();
  // The first-level card blocks the board until it is dismissed.
  await page.getByTestId('td-unlock-ok').click();await expect(page.getByTestId('td-unlock')).toHaveCount(0);
  await expect(page.locator('[data-testid=top-bar-back]:visible')).toHaveCount(1);
  await expect(page.getByTestId('td-pause')).toHaveCount(0);
  await expect(page.getByTestId('td-sound')).toHaveText('');
}
for(const width of [320,390]) test.describe(`TD ${width}`,()=>{
  test.use({viewport:{width,height:700},hasTouch:true});
  test('six cards form three rows; menu and board fit, radial costs, upgrade/sell and speed',async({page})=>{
    await mockApi(page);await page.goto('/game/hub');
    const boxes=await Promise.all(['big','tu','m3','grab','run','td'].map(k=>page.getByTestId(`hub-game-${k}`).boundingBox()));
    for(let i=0;i<6;i+=2){expect(boxes[i]!.y).toBe(boxes[i+1]!.y);expect(boxes[i]!.width).toBe(boxes[i+1]!.width);}
    await page.getByTestId('hub-game-td').click();await expect(page.getByRole('heading',{level:1})).toHaveText(t.title);
    await expect(page.getByTestId('td-menu-level')).toHaveText('第 1 关');await begin(page);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(700);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const c=page.locator('canvas');expect(await c.evaluate(el=>(el as HTMLCanvasElement).width/el.getBoundingClientRect().width)).toBeLessThanOrEqual(2.01);
    // Coin arithmetic follows the current balance (start coins and costs come from the engine).
    const c0=tdLevel(weekKey,1).startCoins,pin=towerStats('rollingPin').cost,pinUp=towerStats('rollingPin',1).cost;
    const c1=c0-pin,c2=c1+Math.floor(pin/2);
    await page.getByTestId('td-slot-0').tap();await page.getByTestId('td-build-rollingPin').tap();await expect(page.getByTestId('td-coins')).toHaveText(String(c1));
    await page.getByTestId('td-slot-0').tap();
    if(c1<towerStats('rollingPin',1).cost) await expect(page.getByTestId('td-upgrade')).toBeDisabled(); else await expect(page.getByTestId('td-upgrade')).toBeEnabled();
    await page.getByTestId('td-sell').tap();await expect(page.getByTestId('td-coins')).toHaveText(String(c2));
    await page.getByTestId('td-slot-0').tap();
    if(c2<pin) {
      // L1's small purse cannot undo a sale by immediately buying again.
      await expect(page.getByTestId('td-build-rollingPin')).toBeDisabled();
    } else {
      await page.getByTestId('td-build-rollingPin').tap();await page.getByTestId('td-slot-0').tap();
      if(c2-pin<pinUp) await expect(page.getByTestId('td-upgrade')).toBeDisabled();
      else {
        await page.getByTestId('td-upgrade').tap();
        await expect(page.getByTestId('td-coins')).toHaveText(String(c2-pin-pinUp));
      }
    }
    await page.getByRole('button',{name:t.closePicker}).click();
    await page.getByTestId('td-speed').click();await expect(page.getByTestId('td-speed')).toHaveText('2×');await page.getByTestId('td-call-wave').click();await expect(page.getByTestId('td-wave')).toHaveText('1/5');
  });
  test('pause/hidden time stops; save resumes without another start, discard and reduced motion',async({page})=>{
    const api=await mockApi(page);await page.emulateMedia({reducedMotion:'reduce'});await page.clock.install();await page.goto('/game/td');await begin(page);
    await page.clock.runFor(1000);await page.getByTestId('td-exit').click();
    const stage=page.getByTestId('td-board'),tick=await stage.getAttribute('data-tick');await page.clock.runFor(5000);await expect(stage).toHaveAttribute('data-tick',tick!);
    await page.getByTestId('td-keep-playing').click();await page.clock.runFor(100);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await stage.getAttribute('data-tick');await page.clock.runFor(5000);await expect(stage).toHaveAttribute('data-tick',hidden!);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByTestId('td-exit').click();await page.getByTestId('td-exit-save').click();await page.reload();await page.getByTestId('td-resume').click();await expect(stage).toBeVisible();expect(api.starts).toHaveLength(1);
    await page.getByTestId('td-exit').click();await page.getByTestId('td-exit-discard').click();expect(await page.evaluate(k=>localStorage.getItem(k),TD_SAVE_KEY)).toBeNull();
  });
  test('failed completed save retries exact run after reload, win offers next level',async({page})=>{
    const api=await mockApi(page),bot=greedyTd(tdLevel(weekKey,1));
    expect(TD_ENGINE_VERSION).toBe(11);
    expect(seed.startsWith(`v${TD_ENGINE_VERSION}.td.`)).toBe(true);
    expect(bot.inputs.some(i=>i.type==='upgrade' && i.branch)).toBe(true);
    const save={v:1,runId:'00000000-0000-4000-8000-000000000099',seed,level:1,weekKey,tiers,nickname:'Baker',expiresAt:'2099-01-01T00:00:00Z',inputs:bot.inputs,endTick:bot.state.tick,score:bot.state.wave};
    await page.addInitScript(({key,save})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,JSON.stringify(save));sessionStorage.setItem('seeded','1');}},{key:TD_SAVE_KEY,save});
    await page.route('**/api/game/td/finish',r=>r.fulfill({status:503,json:{error:'INTERNAL',message:g.submitFailed}}));
    await page.goto('/game/td');await page.getByTestId('td-resume').click();await expect(page.getByTestId('td-retry')).toBeVisible();
    expect(await page.evaluate(k=>localStorage.getItem(k),TD_SAVE_KEY)).not.toBeNull();await page.unroute('**/api/game/td/finish');
    await page.route('**/api/game/td/finish',r=>{api.finishes.push(r.request().postDataJSON());return r.fulfill({json:{score:5,level:1,passed:true,best:1,personalBest:1,rank:1,week:board.week}});});
    await page.reload();await page.getByTestId('td-resume').click();await expect(page.getByTestId('td-again')).toHaveText(t.next);await expect(page.getByTestId('td-confirmed')).toBeVisible();
    expect(api.starts).toHaveLength(0);expect(api.finishes[0].runId).toBe(save.runId);
    expect(await page.evaluate(k=>localStorage.getItem(k),TD_SAVE_KEY)).toBeNull();
  });
  test('undefended failure offers retry and stops simulation',async({page})=>{
    const api=await mockApi(page);await page.clock.install();await page.goto('/game/td');await begin(page);await page.getByTestId('td-call-wave').click();await page.getByTestId('td-speed').click();await page.clock.runFor(90000);
    await expect(page.getByTestId('td-over-sheet')).toBeVisible();await expect(page.getByTestId('td-again')).toHaveText(t.retry);expect(api.finishes).toHaveLength(1);
    const tick=await page.getByTestId('td-board').getAttribute('data-tick');await page.clock.runFor(5000);await expect(page.getByTestId('td-board')).toHaveAttribute('data-tick',tick!);
  });
});
