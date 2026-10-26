// L2: one game played against the REAL engine and API (no mocks): start -> play to game over ->
// the server replays the drop log and confirms the score -> the leaderboard lists it.
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { resetAndSeed } from "./support/seed";

test.use({ browserName: "chromium" });

const g = copy.customer.game;

test("real game: play to game over, the server confirms the score and the board lists it", async ({ page, request }) => {
  test.setTimeout(240_000);
  await resetAndSeed();
  await page.goto("/game");
  await page.getByTestId("game-wechat").fill("real_player_1");
  await page.getByTestId("game-nickname").fill("真玩家");
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();

  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  const xs = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.15, 0.85];
  const sheet = page.getByTestId("game-over-sheet");
  for (let i = 0; i < 400 && !(await sheet.isVisible()); i++) {
    await page.mouse.click(box.x + box.width * xs[i % xs.length], box.y + box.height * 0.3);
    await page.waitForTimeout(270);
  }
  await expect(sheet).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("game-confirmed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("game-confirmed")).toContainText(g.confirmed);
  const shown = Number(await page.getByTestId("game-final-score").innerText());
  const best = Number(await page.getByTestId("game-best").innerText());
  expect(best).toBe(shown); // the server's replay agrees with the client's score

  const board = await (await request.get("/api/game/leaderboard")).json();
  expect(board.top[0].nickname).toBe("真玩家");
  expect(board.top[0].score).toBe(shown);
});
