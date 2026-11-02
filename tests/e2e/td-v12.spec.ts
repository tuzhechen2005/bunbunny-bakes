import { expect, test } from '@playwright/test';
import { createTdGame, replayTd, tdLevel, type TdEvent, type TdInput } from '../../src/lib/td';
import { TD_SAVE_KEY } from '../../src/components/td/tdSave';
import { greedyTd } from '../support/tdBot';
// TD v12 UI: boss bar and phases, swarm mice, clutter targeting, stars. The run is a recorded bot log that the page resumes
// by replay, then pauses at a chosen tick so the canvas can be inspected.
const weekKey = '2026-10-19', level = tdLevel(weekKey, 1);
const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, radius: .1, points: 1, name: 'Bread', imageUrl: '/brand/logo.webp', color: { bg: 'white', ink: 'black' } }));
const shots = process.env.TD_SHOTS ?? 'test-results';
const board = { liveScores: true, nextLevel: 1, week: { start: weekKey, end: '2026-10-25' }, top: [], lastWinner: null, allTime: null, bestStars: { 1: 2, 2: 3 } };
const run = greedyTd(level);
const events: TdEvent[] = [];
{ const g = createTdGame({ level, tierCount: tiers.length }); let i = 0; for (let t = 0; t <= run.state.tick; t++) { events.push(...g.step(t)); while (i < run.inputs.length && run.inputs[i].tick === t) g.apply(run.inputs[i++]); } }
const phases = events.filter(e => e.type === 'bossPhase'), spawn = events.find(e => e.type === 'bossSpawn')!;

async function resume(page: import('@playwright/test').Page, inputs: TdInput[], endTick: number, finish?: object) {
  const state = replayTd({ seed: level.seed, tierCount: tiers.length, itemsAllowed: {} }, inputs, endTick);
  const save = { runId: '00000000-0000-4000-8000-000000000001', seed: level.seed, level: 1, weekKey, tiers, expiresAt: '2099-01-01T00:00:00Z', inventory: {}, v: 1, nickname: 'Baker', inputs, endTick, score: state.wave };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [TD_SAVE_KEY, JSON.stringify(save)]);
  await page.route('**/api/game/td/leaderboard**', r => r.fulfill({ json: board }));
  await page.route('**/api/game/td/progress', r => r.fulfill({ json: { score: 0, live: true } }));
  if (finish) await page.route('**/api/game/td/finish', r => r.fulfill({ json: finish }));
  await page.goto('/game/td'); await page.getByTestId('td-resume').click();
  const hold = page.getByTestId('td-hold'), ok = page.getByTestId('td-unlock-ok');
  if (!state.over) { await expect(hold).toBeEnabled(); await hold.click(); }
  await ok.click({ timeout: 4000 }).catch(() => {});
  await page.addStyleTag({ content: '.td-hold-cover { display: none !important; }' }); // screenshots only
}
test.describe('TD v12 (landscape phone)', () => {
  test.use({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true });
  test('boss: spawn, telegraph + spit, dash, last segment', async ({ page }) => {
    await resume(page, run.inputs, spawn.tick + 400);
    await page.screenshot({ path: `${shots}/ui-td-boss-bar.png` });
    expect(phases.length).toBe(2);
  });
  test('boss phase spit burst', async ({ page }) => {
    await resume(page, run.inputs, phases[0].tick - 70);
    await page.getByTestId('td-hold').click();
    // Pausing rebuilds the renderer (and drops its effects), so this one is captured while running.
    await page.waitForFunction(t => Number(document.querySelector('[data-testid=td-board]')?.getAttribute('data-tick')) >= t, phases[0].tick + 4);
    await page.screenshot({ path: `${shots}/ui-td-boss-spit.png` });
  });
  for (const [name, offset] of [['telegraph', 6], ['dash', 52]] as const) {
    test(`boss phase ${name}`, async ({ page }) => {
      await resume(page, run.inputs, phases[0].tick + offset);
      await page.screenshot({ path: `${shots}/ui-td-boss-${name}.png` });
    });
  }
  test('clutter: tap targets, ring, damage, break', async ({ page }) => {
    const inputs: TdInput[] = [{ tick: 0, type: 'place', slot: 0, tower: 'rollingPin' }, { tick: 0, type: 'callWave', slot: -1 }];
    await resume(page, inputs, 20);
    await page.getByTestId('td-hold').click(); // resume play (a paused board is inert)
    await page.getByTestId('td-clutter-0').tap();
    await expect(page.getByTestId('td-clutter-0')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1300);
    await page.getByTestId('td-hold').click();
    await page.screenshot({ path: `${shots}/ui-td-clutter-hit.png` });
    await page.getByTestId('td-hold').click();
    await page.getByTestId('td-clutter-0').waitFor({ state: 'detached', timeout: 8000 });
    await page.screenshot({ path: `${shots}/ui-td-clutter-broken.png` });
    await expect(page.getByTestId('td-clutter-0')).toHaveCount(0);
  });
  test('stars on the result sheet and best stars on the menu', async ({ page }) => {
    await resume(page, run.inputs, run.state.tick, { score: 5, best: 5, rank: 1, week: { start: weekKey, end: '2026-10-25' }, level: 1, passed: true, stars: 3, bestStars: { 1: 3, 2: 3 } });
    await expect(page.getByTestId('td-over-sheet').getByTestId('td-stars')).toHaveAttribute('data-stars', '3');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/ui-td-stars-result.png` });
  });
});
