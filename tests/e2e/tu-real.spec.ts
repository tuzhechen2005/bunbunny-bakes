// T3: one 兔了个兔 run against the REAL engine and API (no mocks): start -> a bot plays tap by tap ->
// the server replays the taps and confirms the score -> the leaderboard lists it.
// Skipped while the server (T2, /api/game/tu/*) is not part of this build.
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { randomTu } from "../support/tuBot";
import { resetAndSeed } from "./support/seed";

test.use({ browserName: "chromium" });

const g = copy.customer.game;

test("real tu: play to game over, the server confirms the score and the board lists it", async ({ page, request }) => {
  test.setTimeout(240_000);
  const probe = await request.get("/api/game/tu/leaderboard");
  test.skip(probe.status() === 404, "the 兔了个兔 server is not in this build");
  await resetAndSeed();
  await page.goto("/game/tu");
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-wechat").fill("real_tu_player");
  await page.getByTestId("tu-nickname").fill("真玩家");
  const started = page.waitForResponse((r) => r.url().includes("/api/game/tu/start"));
  await page.getByTestId("tu-start").click();
  const { seed, tiers } = await (await started).json();
  await expect(page.getByTestId("tu-board")).toBeVisible();

  // A random player is out in batch 1; the bot's tile ids are the engine's, the page plays the same engine.
  const bot = randomTu(seed, tiers);
  expect(bot.over).toBe(true);
  for (const tp of bot.taps) {
    await page.getByTestId(`tu-tile-${tp.id}`).click();
    await page.waitForTimeout(170);
  }
  const sheet = page.getByTestId("tu-over-sheet");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tu-confirmed")).toContainText(g.confirmed, { timeout: 20_000 });
  const shown = Number(await page.getByTestId("tu-final-score").innerText());
  expect(shown).toBe(bot.score);
  expect(Number(await page.getByTestId("tu-best").innerText())).toBe(shown);
  const board = await (await request.get("/api/game/tu/leaderboard")).json();
  expect(board.top[0].nickname).toBe("真玩家");
  expect(board.top[0].score).toBe(shown);
});
