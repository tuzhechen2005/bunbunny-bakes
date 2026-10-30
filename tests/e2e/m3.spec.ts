// S3: mocked API contract + real deterministic engine. Claude runs browsers after S2 merges.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createM3Game, legalM3Moves, replayM3, type M3Cell, type M3Move, type M3State, type M3Swap } from "../../src/lib/m3";
import { M3_SAVE_KEY } from "../../src/components/m3/m3Save";
import { chooseM3Move } from "../support/m3Bot";
import { drag, finger } from "./support/touch";

const SEED = "m3-tune87";
const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const TIERS = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `面包${i}`, radius: .1, points: 10, imageUrl: i ? `/api/images/mock/m3-${i}.jpg` : null, color: { bg: "#EFE7DA", ink: "#4A2723" } }));
const BOARD = { week: { start: "2026-11-02", end: "2026-11-08" }, top: [{ rank: 1, nickname: "小面包", wechatMasked: "bu***01", score: 8000 }], lastWinner: null, allTime: { nickname: "兔兔", wechatMasked: "ra***ab", score: 9000 } };
const g = copy.customer.game;

async function mockApi(page: Page, prize: "M3" | "TU" = "M3") {
  const starts: unknown[] = [];
  const finishes: { runId: string; moves: M3Move[] }[] = [];
  await page.route("**/api/menu", r => r.fulfill({ json: { products: [], ownerWechatId: "test_owner" } }));
  await page.route(/\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/, r => r.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/game/hub", r => r.fulfill({ json: { week: BOARD.week, prizeGame: prize, games: [
    { kind: "BIG", href: "/game", name: g.title, weekBest: 1 },
    { kind: "TU", href: "/game/tu", name: copy.customer.tu.title, weekBest: 2 },
    { kind: "M3", href: "/game/m3", name: copy.customer.m3.title, weekBest: 3 },
  ] } }));
  await page.route("**/api/game/m3/leaderboard**", r => r.fulfill({ json: BOARD }));
  await page.route("**/api/game/m3/start", r => {
    starts.push(r.request().postDataJSON());
    return r.fulfill({ json: { runId: `m3-run-${starts.length}`, seed: SEED, tiers: TIERS, nickname: "小面包", expiresAt: "2099-01-01T00:00:00Z" } });
  });
  await page.route("**/api/game/m3/finish", r => {
    const body = r.request().postDataJSON();
    finishes.push(body);
    const { score } = replayM3(SEED, TIERS, body.moves);
    return r.fulfill({ json: { score, best: score, rank: 1, week: BOARD.week, personalBest: score, newRecord: true } });
  });
  return { starts, finishes };
}
async function start(page: Page) {
  await page.getByTestId("m3-menu-start").click();
  await page.getByTestId("m3-wechat").fill("m3_fan");
  await page.getByTestId("m3-nickname").fill("小面包");
  await page.getByTestId("m3-start").click();
  await expect(page.getByTestId("m3-board")).toBeVisible();
}
const cell = (page: Page, p: M3Cell) => page.getByTestId(`m3-cell-${p.r}-${p.c}`);
async function tapSwap(page: Page, m: M3Swap) {
  await cell(page, m.a).click();
  await cell(page, m.b).click();
}
async function settled(page: Page, state: M3State) {
  await expect(page.getByTestId("m3-board")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(page.getByTestId("m3-score")).toHaveText(String(state.score));
  await expect(page.getByTestId("m3-moves")).toHaveText(String(state.movesLeft));
  const codes = await page.locator("[data-cell]").evaluateAll(els => els.map(el => Number((el as HTMLElement).dataset.code)));
  expect(codes).toEqual(state.board.flat());
  for (let i = 0; i < 2; i++) {
    await expect(page.getByTestId(`m3-order-${i}`)).toHaveAttribute("data-have", String(state.orders[i].have));
    await expect(page.getByTestId(`m3-order-${i}`)).toHaveAttribute("data-tier", String(state.orders[i].tier));
  }
}
async function swipe(page: Page, m: M3Swap) {
  const a = (await cell(page, m.a).boundingBox())!;
  const b = (await cell(page, m.b).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await drag(finger(cdp), [a.x + a.width / 2, a.y + a.height / 2], [b.x + b.width / 2, b.y + b.height / 2]);
  await cdp.detach();
}

for (const width of [320, 390]) {
  test.describe(`M3 ${width}px`, () => {
    test.use({ browserName: "chromium", viewport: { width, height: 800 }, hasTouch: true });

    test("menu, leaderboard, hub third row and prize gating", async ({ page }) => {
      await mockApi(page);
      await page.goto("/game/hub");
      const m3 = page.getByTestId("hub-game-m3");
      await expect(m3).toHaveAttribute("href", "/game/m3");
      const first = (await page.getByTestId("hub-game-big").boundingBox())!;
      const third = (await m3.boundingBox())!;
      expect(third.y).toBeGreaterThanOrEqual(first.y + first.height);
      await m3.click();
      await expect(page).toHaveURL(/\/game\/m3$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.customer.m3.title);
      await expect(page.getByTestId("m3-prize-line")).toHaveText(g.prizeLine);
      await expect(page.getByTestId("m3-rules")).toContainText("test_owner");
      await expect(page.getByTestId("top-bar-back").filter({ visible: true })).toHaveAttribute("href", "/game/hub");
      await page.getByTestId("m3-open-board").click();
      await expect(page.getByTestId("game-all-time")).toContainText("9000");
      await page.getByTestId("m3-board-close").click();
      await expect(page.getByTestId("m3-menu-start")).toBeVisible();
      await page.route("**/api/game/hub", r => r.fulfill({ json: { week: BOARD.week, prizeGame: "TU", games: [] } }));
      await page.reload();
      await expect(page.getByTestId("m3-rules")).toHaveText(copy.customer.gameHub.rules);
      await expect(page.getByTestId("m3-prize-line")).toHaveCount(0);
    });

    test("legal swipe, illegal swap returns, orders, autosave and resume", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto("/game/m3");
      await start(page);
      expect(api.starts).toEqual([{ wechatId: "m3_fan", nickname: "小面包" }]);
      await expect(page.locator("[data-cell]")).toHaveCount(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByTestId("m3-board").locator("canvas")).toHaveCount(0);
      const game = createM3Game({ seed: SEED, tiers: TIERS });
      const before = game.state();
      // Exercise a vertical swipe: it must prevent page scrolling too.
      const move = legalM3Moves(before).find(m => m.a.r !== m.b.r)!;
      const scroll = await page.evaluate(() => scrollY);
      await swipe(page, move);
      game.swap(move.a, move.b);
      await settled(page, game.state());
      expect(await page.evaluate(() => scrollY)).toBe(scroll);
      const illegal = before.board.flatMap((row, r) => row.slice(0, 7).map((_, c) => ({ a: { r, c }, b: { r, c: c + 1 } })))
        .find(m => !legalM3Moves(game.state()).some(v => JSON.stringify(v) === JSON.stringify(m)))!;
      const saved = await page.evaluate(key => localStorage.getItem(key), M3_SAVE_KEY);
      await tapSwap(page, illegal);
      await expect(page.locator(".m3-invalid")).toHaveCount(2);
      await settled(page, game.state());
      expect(await page.evaluate(key => localStorage.getItem(key), M3_SAVE_KEY)).toBe(saved);
      await page.getByTestId("m3-exit").click();
      await page.getByTestId("m3-exit-save").click();
      await expect(page.getByTestId("m3-resume")).toBeVisible();
      await page.reload();
      await page.getByTestId("m3-resume").click();
      await settled(page, game.state());
      expect(api.starts).toHaveLength(1);
      // Continue from the replayed RNG, with monotonic timestamps across sessions.
      const next = legalM3Moves(game.state())[0];
      await tapSwap(page, next); game.swap(next.a, next.b);
      await settled(page, game.state());
      const log = JSON.parse((await page.evaluate(key => localStorage.getItem(key), M3_SAVE_KEY))!);
      expect(replayM3(SEED, TIERS, log.moves).score).toBe(game.score);
    });

    test("30 moves, order completion, closable result, best, bottom bar and leaderboard return", async ({ page }) => {
      test.setTimeout(240_000);
      const api = await mockApi(page);
      await page.goto("/game/m3");
      await start(page);
      const game = createM3Game({ seed: SEED, tiers: TIERS });
      let completed = 0;
      while (!game.over) {
        const move = chooseM3Move(game.state(), true, () => 0);
        const events = game.swap(move.a, move.b)!;
        await tapSwap(page, move);
        await expect(page.getByTestId("m3-board")).toHaveAttribute("aria-busy", "true");
        await expect(cell(page, move.a)).toBeDisabled();
        if (events.some(e => e.type === "order" && e.action === "complete")) {
          completed++;
          await expect(page.locator(".m3-order-done").first()).toBeVisible({ timeout: 15_000 });
        }
        await settled(page, game.state());
      }
      expect(completed).toBeGreaterThan(0);
      await expect(page.getByTestId("m3-over-sheet")).toBeVisible();
      await expect(page.getByTestId("m3-final-score")).toHaveText(String(game.score));
      await expect(page.getByTestId("m3-personal-best")).toHaveText(String(game.score));
      await expect(page.getByTestId("m3-new-record")).toBeVisible();
      expect(api.finishes).toHaveLength(1);
      expect(api.finishes[0].moves).toHaveLength(30);
      expect(await page.evaluate(key => localStorage.getItem(key), M3_SAVE_KEY)).toBeNull();
      await page.getByTestId("m3-over-close").click();
      await expect(page.getByTestId("m3-bar")).toBeVisible();
      await settled(page, game.state());
      await page.getByTestId("m3-bar-score").click();
      await expect(page.getByTestId("m3-over-sheet")).toBeVisible();
      await page.getByTestId("m3-to-board").click();
      await expect(page.getByTestId("game-row")).toHaveCount(1);
      await page.getByTestId("m3-board-close").click();
      await page.getByTestId("m3-over-close").click();
      await settled(page, game.state());
      expect(api.finishes).toHaveLength(1);
    });

    test("reduced motion uses fades, no hints or transforms; normal idle hint names a legal pair", async ({ page }) => {
      await mockApi(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/game/m3"); await start(page);
      await expect(page.getByTestId("m3-play")).toHaveAttribute("data-reduced", "true");
      await page.waitForTimeout(5200);
      await expect(page.locator(".m3-hint")).toHaveCount(0);
      const game = createM3Game({ seed: SEED, tiers: TIERS });
      const move = legalM3Moves(game.state())[0];
      await tapSwap(page, move); game.swap(move.a, move.b);
      const transforms = await page.locator(".m3-piece").evaluateAll(els => els.map(el => getComputedStyle(el).transform));
      expect(transforms.every(t => t === "none")).toBe(true);
      await settled(page, game.state());
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(page.locator(".m3-hint")).toHaveCount(2, { timeout: 7000 });
      const hinted = await page.locator(".m3-cell:has(.m3-hint) [data-cell]").evaluateAll(els => els.map(el => (el as HTMLElement).dataset.cell));
      expect(legalM3Moves(game.state()).some(m => hinted.includes(`${m.a.r},${m.a.c}`) && hinted.includes(`${m.b.r},${m.b.c}`))).toBe(true);
    });

    test("unavailable start, corrupt and expired saves do not enter the board", async ({ page }) => {
      const api = await mockApi(page);
      await page.addInitScript(key => localStorage.setItem(key, '{"v":1,"expiresAt":"2000-01-01"}'), M3_SAVE_KEY);
      await page.route("**/api/game/m3/start", r => r.fulfill({ status: 409, json: { error: "UNAVAILABLE", message: copy.customer.m3.unavailable } }));
      await page.goto("/game/m3");
      await expect(page.getByTestId("m3-resume")).toHaveCount(0);
      await page.getByTestId("m3-menu-start").click();
      await page.getByTestId("m3-start").click();
      await expect(page.getByText(g.wechatInvalid)).toBeVisible();
      expect(api.starts).toHaveLength(0);
      await page.getByTestId("m3-wechat").fill("m3_fan");
      await page.getByTestId("m3-nickname").fill("小面包");
      await page.getByTestId("m3-start").click();
      await expect(page.getByTestId("m3-form-error")).toHaveText(copy.customer.m3.unavailable);
      await expect(page.getByTestId("m3-board")).toHaveCount(0);
    });
  });
}
