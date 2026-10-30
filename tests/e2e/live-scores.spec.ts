import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { BOARD_REFRESH_MS, PROGRESS_REPORT_MS } from "../../src/lib/liveScores";

test.use({ browserName: "chromium", reducedMotion: "reduce" });
const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `面包${i}`, radius: .07 + i * .02,
  points: i * 10, imageUrl: null, color: { bg: "var(--c-wash)", ink: "var(--c-ink)" } }));
const week = { start: "2026-10-26", end: "2026-11-01" };

for (const game of ["big", "tu", "m3"]) {
  const path = game === "big" ? "/game" : `/game/${game}`;
  const prefix = game === "big" ? "game" : game;
  const api = `/api${path}`;
  test(`${game}: reports at 10s, flushes hidden/exit, stops after 404 and refreshes the visible board`, async ({ page }) => {
    let reports = 0, boards = 0, off = false;
    const payloads: { runId: string; log: unknown[] }[] = [];
    await page.route("**/api/menu", r => r.fulfill({ json: { products: [] } }));
    await page.route("**/api/game/hub", r => r.fulfill({ json: { liveScores: true, week, prizeGame: "BIG", games: [] } }));
    await page.route(`**${api}/start`, r => r.fulfill({ json: { runId: "test-run", seed: "test-seed", tiers: game === "big" ? [...tiers, { ...tiers[5], id: "big", radius: .25 }] : tiers, expiresAt: "2099-01-01" } }));
    await page.route(`**${api}/progress`, r => {
      reports++; payloads.push(r.request().postDataJSON());
      return r.fulfill({ status: off ? 404 : 200, json: { score: 0 } });
    });
    await page.route(`**${api}/leaderboard**`, r => {
      boards++;
      return r.fulfill({ json: { liveScores: !off, week, top: [{ rank: 1, nickname: "兔兔", wechatMasked: "wx***01", score: boards, live: true }], lastWinner: null } });
    });
    await page.clock.install();
    await page.goto(path);
    await page.getByTestId(`${prefix}-menu-start`).click();
    await page.getByTestId(`${prefix}-wechat`).fill("tester");
    await page.getByTestId(`${prefix}-nickname`).fill("兔兔");
    await page.getByTestId(`${prefix}-start`).click();
    await expect(page.getByTestId(`${prefix}-exit`)).toBeVisible();
    await page.clock.runFor(PROGRESS_REPORT_MS);
    await expect.poll(() => reports).toBe(1);
    expect(payloads[0]).toEqual({ runId: "test-run", log: [] });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => reports).toBe(2);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByTestId(`${prefix}-exit`).click();
    await page.getByTestId(`${prefix}-exit-discard`).click();
    await expect(page.getByTestId(`${prefix}-menu-start`)).toBeVisible();
    await expect.poll(() => reports).toBe(3);
    await page.getByTestId(`${prefix}-open-board`).click();
    await expect(page.getByTestId("game-live")).toHaveText(`${copy.customer.game.liveDot} ${copy.customer.game.live}`);
    const initial = boards;
    await page.clock.runFor(BOARD_REFRESH_MS);
    await expect.poll(() => boards).toBe(initial + 1);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(BOARD_REFRESH_MS * 2);
    expect(boards).toBe(initial + 1);
    off = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("game-live")).toHaveCount(0);
    const stopped = boards;
    await page.clock.runFor(BOARD_REFRESH_MS * 2);
    expect(boards).toBe(stopped);
    await page.getByTestId(`${prefix}-board-close`).click();
    await page.getByTestId(`${prefix}-menu-start`).click();
    await page.getByTestId(`${prefix}-start`).click();
    await expect(page.getByTestId(`${prefix}-exit`)).toBeVisible();
    await page.clock.runFor(PROGRESS_REPORT_MS);
    await expect.poll(() => reports).toBe(4);
    await page.clock.runFor(PROGRESS_REPORT_MS * 3);
    expect(reports).toBe(4);
  });
}

test("hub refreshes live scores, then obeys the server kill switch", async ({ page }) => {
  let count = 0;
  await page.route("**/api/game/hub", r => {
    count++;
    return r.fulfill({ json: { liveScores: count < 2, week, prizeGame: "BIG", games: [
      { kind: "BIG", href: "/game", name: copy.customer.game.title, weekBest: count, live: true },
    ] } });
  });
  await page.clock.install();
  await page.goto("/game/hub");
  await expect(page.getByTestId("game-live")).toBeVisible();
  await page.clock.runFor(BOARD_REFRESH_MS);
  await expect(page.getByTestId("game-live")).toHaveCount(0);
  const stopped = count;
  await page.clock.runFor(BOARD_REFRESH_MS * 2);
  expect(count).toBe(stopped);
});
