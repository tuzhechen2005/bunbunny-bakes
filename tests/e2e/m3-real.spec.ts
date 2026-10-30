// S3: one 兔兔三连烤 run against the REAL engine and API (no mocks): start -> a greedy bot plays
// all 30 moves through the page -> the server replays the moves and confirms the score -> the
// leaderboard lists it. Also: fewer than six bread pieces -> start is refused.
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createM3Game, MIN_MOVE_GAP_MS, type M3Cell } from "../../src/lib/m3";
import { chooseM3Move } from "../support/m3Bot";
import { resetAndSeed, withDb } from "./support/seed";

test.use({ browserName: "chromium" });

const g = copy.customer.game;

async function seedPieces(n: number) {
  await resetAndSeed();
  await withDb(async (c) => {
    await c.query(`TRUNCATE "GameTier","GameRun","GameBan","GameAward"`);
    for (let i = 0; i < n; i++) {
      await c.query(`INSERT INTO "GameTier" ("sortOrder","name","isBig","updatedAt") VALUES ($1,$2,false,now())`, [i, `面包${i}`]);
    }
    await c.query(`INSERT INTO "GameTier" ("sortOrder","isBig","updatedAt") VALUES ($1,true,now())`, [n]);
  });
}

async function startRun(page: Page) {
  await page.goto("/game/m3");
  await page.getByTestId("m3-menu-start").click();
  await page.getByTestId("m3-wechat").fill("real_m3_player");
  await page.getByTestId("m3-nickname").fill("真玩家");
  const started = page.waitForResponse((r) => r.url().includes("/api/game/m3/start"));
  await page.getByTestId("m3-start").click();
  return started;
}

const cell = (page: Page, p: M3Cell) => page.getByTestId(`m3-cell-${p.r}-${p.c}`);

test("real m3: 30 moves, the server confirms the score and the board lists it", async ({ page, request }) => {
  test.setTimeout(300_000);
  await seedPieces(6);
  const res = await startRun(page);
  expect(res.ok()).toBe(true);
  const { seed, tiers } = await res.json();
  expect(tiers).toHaveLength(6);
  await expect(page.getByTestId("m3-board")).toBeVisible();

  const game = createM3Game({ seed, tiers });
  while (!game.over) {
    const move = chooseM3Move(game.state(), true, () => 0);
    game.swap(move.a, move.b);
    await cell(page, move.a).click();
    await cell(page, move.b).click();
    await expect(page.getByTestId("m3-board")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(page.getByTestId("m3-moves")).toHaveText(String(game.state().movesLeft));
    // Human pacing between moves (the server checks the gap).
    await page.waitForTimeout(MIN_MOVE_GAP_MS + 50);
  }
  await expect(page.getByTestId("m3-over-sheet")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("m3-confirmed")).toContainText(g.confirmed, { timeout: 20_000 });
  const shown = Number(await page.getByTestId("m3-final-score").innerText());
  expect(shown).toBe(game.score);
  const board = await (await request.get("/api/game/m3/leaderboard")).json();
  expect(board.top[0].nickname).toBe("真玩家");
  expect(board.top[0].score).toBe(shown);
});

test("real m3: fewer than six bread pieces -> start is refused, no board", async ({ page }) => {
  await seedPieces(5);
  const res = await startRun(page);
  expect(res.ok()).toBe(false);
  await expect(page.getByRole("alert").filter({ hasText: copy.gameApi.m3NotReady })).toBeVisible();
  await expect(page.getByTestId("m3-board")).toHaveCount(0);
});
