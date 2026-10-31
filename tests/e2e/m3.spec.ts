// S9: weekly levels, replayed HUD, autosave and both result actions. No browser run in S9.
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createM3Game, m3Level, m3LevelWitness, replayM3, legalM3Moves, type M3Move } from "../../src/lib/m3";
import { createRng } from "../../src/lib/game/rng";
import { M3_SAVE_KEY } from "../../src/components/m3/m3Save";

test.use({ browserName: "chromium" });

const WEEK = "2026-10-26";
const TIERS = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `面包${i}`, radius: .1, points: 10, imageUrl: null, color: { bg: "var(--c-wash)", ink: "var(--c-ink)" } }));
const t = copy.customer.m3, g = copy.customer.game;
const definition = (level: number) => ({ ...m3Level(WEEK, level), level, weekKey: WEEK });

async function mockApi(page: Page) {
  const starts: { level?: number }[] = [], finishes: { runId: string; moves: M3Move[] }[] = [];
  const runs = new Map<string, ReturnType<typeof definition>>();
  let passed = 0;
  await page.route("**/api/menu", r => r.fulfill({ json: { products: [], ownerWechatId: "test_owner" } }));
  await page.route("**/api/game/hub", r => r.fulfill({ json: { prizeGame: "M3", games: [] } }));
  await page.route("**/api/game/m3/leaderboard**", r => r.fulfill({ json: {
    liveScores: true, week: { start: WEEK, end: "2026-11-01" }, nextLevel: passed + 1,
    top: passed ? [{ rank: 1, nickname: "小面包", wechatMasked: "m3***an", score: passed, live: false }] : [],
    myBest: passed, lastWinner: null, allTime: passed ? { nickname: "小面包", wechatMasked: "m3***an", score: passed } : null,
  } }));
  await page.route("**/api/game/m3/start", r => {
    const body = r.request().postDataJSON(); starts.push(body);
    const level = body.level ?? passed + 1, rules = definition(level), runId = `run-${starts.length}`;
    runs.set(runId, rules);
    return r.fulfill({ json: { ...rules, runId, tiers: TIERS.slice(0, rules.tierCount), expiresAt: "2099-01-01T00:00:00Z" } });
  });
  await page.route("**/api/game/m3/progress", r => r.fulfill({ json: { score: 0, live: true } }));
  await page.route("**/api/game/m3/finish", r => {
    const body = r.request().postDataJSON(); finishes.push(body);
    const rules = runs.get(body.runId)!;
    const outcome = replayM3(rules.seed, TIERS.slice(0, rules.tierCount), body.moves, rules);
    const won = outcome.score >= rules.target;
    if (won) passed = Math.max(passed, rules.level);
    return r.fulfill({ json: { ...outcome, passed: won, level: rules.level, best: passed, personalBest: passed, newRecord: won,
      rank: passed ? 1 : null, week: { start: WEEK, end: "2026-11-01" } } });
  });
  return { starts, finishes };
}
async function start(page: Page) {
  await page.goto("/game/m3");
  await page.getByTestId("m3-menu-start").click();
  await page.getByTestId("m3-wechat").fill("m3_fan");
  await page.getByTestId("m3-nickname").fill("小面包");
  await page.getByTestId("m3-start").click();
  await expect(page.getByTestId("m3-board")).toBeVisible();
}
async function play(page: Page, moves: M3Move[]) {
  for (const move of moves) {
    await page.getByTestId(`m3-cell-${move.a.r}-${move.a.c}`).click();
    await page.getByTestId(`m3-cell-${move.b.r}-${move.b.c}`).click();
    await expect(page.getByTestId("m3-board")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  }
}
function losingPath() {
  const rules = definition(1);
  for (let attempt = 0; attempt < 100; attempt++) {
    const game = createM3Game({ ...rules, tiers: TIERS.slice(0, rules.tierCount) });
    const rng = createRng(`fail:${attempt}`), moves: M3Move[] = [];
    while (!game.over) {
      const legal = legalM3Moves(game.state()), m = legal[rng.int(legal.length)];
      game.swap(m.a, m.b); moves.push({ ...m, at: moves.length * 500 });
    }
    if (game.score < rules.target) return moves;
  }
  throw new Error("missing losing fixture");
}

for (const width of [320, 390]) {
  test.describe(`weekly M3 ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: true, reducedMotion: "reduce" });
    test("resumes a level exactly, wins early, starts the next and shows level ranking", async ({ page }) => {
      test.setTimeout(180_000);
      const api = await mockApi(page);
      await start(page);
      const rules = definition(1), path = m3LevelWitness(rules)!;
      await expect(page.getByTestId("m3-level")).toHaveText("第 1 关");
      await expect(page.getByTestId("m3-target")).toHaveAttribute("max", String(rules.target));
      await play(page, path.slice(0, 1));
      const partial = replayM3(rules.seed, TIERS.slice(0, rules.tierCount), path.slice(0, 1), rules);
      await page.reload();
      await expect(page.getByTestId("m3-menu-level")).toHaveText("第 1 关");
      await page.getByTestId("m3-resume").click();
      await expect(page.getByTestId("m3-score")).toHaveText(String(partial.score));
      await expect(page.getByTestId("m3-moves")).toHaveText(String(rules.moves - 1));
      await play(page, path.slice(1));
      await expect(page.getByTestId("m3-over-sheet")).toContainText(t.win);
      await expect(page.getByTestId("m3-again")).toHaveText(t.next);
      await expect(page.getByTestId("m3-again")).toBeEnabled();
      expect(api.finishes).toHaveLength(1);
      expect(api.finishes[0].moves).toHaveLength(path.length);
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), M3_SAVE_KEY)).toBeNull();
      await page.getByTestId("m3-to-board").click();
      await expect(page.getByTestId("game-my-best")).toContainText(t.levels);
      await expect(page.getByTestId("game-row")).toContainText("小面包");
      await page.getByTestId("m3-board-close").click();
      await page.getByTestId("m3-again").click();
      await expect(page.getByTestId("m3-level")).toHaveText("第 2 关");
      expect(api.starts.at(-1)?.level).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test("fails at zero moves and retries the identical level", async ({ page }) => {
      test.setTimeout(180_000);
      const api = await mockApi(page);
      await start(page);
      await play(page, losingPath());
      await expect(page.getByTestId("m3-moves")).toHaveText("0");
      await expect(page.getByTestId("m3-over-sheet")).toContainText(t.fail);
      await expect(page.getByTestId("m3-again")).toHaveText(t.retry);
      await page.getByTestId("m3-again").click();
      await expect(page.getByTestId("m3-level")).toHaveText("第 1 关");
      await expect(page.getByTestId("m3-score")).toHaveText("0");
      expect(api.starts.at(-1)?.level).toBe(1);
    });
    test("discards old v2 saves gracefully and keeps prize/menu copy minimal", async ({ page }) => {
      await mockApi(page);
      await page.addInitScript(() => localStorage.setItem("bb_m3_save_v2", JSON.stringify({ v: 1, seed: "v2.abcdef" })));
      await page.goto("/game/m3");
      await expect(page.getByTestId("m3-resume")).toHaveCount(0);
      await expect(page.getByTestId("m3-menu-start")).toHaveText(g.start);
      await expect(page.getByTestId("m3-menu-level")).toHaveText("第 1 关");
      await expect(page.getByTestId("m3-prize-line")).toHaveText(g.prizeLine);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("bb_m3_save_v2"))).toBeNull();
    });
  });
}
