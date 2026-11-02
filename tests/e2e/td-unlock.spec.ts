import { expect, test } from '@playwright/test';
import { tdLevel } from '../../src/lib/td';
// The new-tower card must stay fully closable on short phone screens (owner report 11/01).
const weekKey='2026-10-19',level=tdLevel(weekKey,1);
const tiers=[{id:'bread',radius:.1,points:1,name:'Bread',imageUrl:'/brand/logo.webp',color:{bg:'white',ink:'black'}}];
const board={liveScores:true,nextLevel:1,week:{start:weekKey,end:'2026-10-25'},top:[],lastWinner:null,allTime:null};
for (const [name,width,height] of [['SE landscape',667,375],['mini landscape',812,340],['portrait 320',320,568]] as const) {
  test.describe(name,()=>{
    test.use({viewport:{width,height},hasTouch:true,isMobile:true});
    test('two new towers: 知道了 is on screen and closes the card',async({page})=>{
      await page.route('**/api/game/td/leaderboard**',r=>r.fulfill({json:board}));
      await page.route('**/api/game/td/progress',r=>r.fulfill({json:{score:0,live:true}}));
      await page.route('**/api/game/td/start',r=>r.fulfill({json:{runId:'00000000-0000-4000-8000-000000000001',seed:level.seed,level:1,weekKey,mapData:level.mapData,
        unlockedTowers:['rollingPin','flourSifter'],newlyUnlocked:['rollingPin','flourSifter'],inventory:{bomb:0,bell:0,slide:0},tiers,expiresAt:'2099-01-01T00:00:00Z'}}));
      await page.goto('/game/td');await page.getByTestId('td-menu-start').click();
      await page.getByTestId('td-wechat').fill('baker');await page.getByTestId('td-nickname').fill('Baker');await page.getByTestId('td-start').click();
      const ok=page.getByTestId('td-unlock-ok');await expect(ok).toBeVisible();
      // Measure after the pop-in animation settles.
      await page.getByTestId('td-unlock').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
      await page.screenshot({path:`test-results/td-unlock-${width}x${height}.png`});
      const box=(await ok.boundingBox())!;
      // The play box may be rotated; whichever way, the button lies inside the viewport.
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(height);
      await ok.tap();await expect(page.getByTestId('td-unlock')).toHaveCount(0);
    });
  });
}
