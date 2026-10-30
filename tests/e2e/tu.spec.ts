// T3 (D121–D126): the /game/tu page. Every API answer is mocked (contract C6); the engine in the page
// is the real one (src/lib/tu), so the bots in tests/support/tuBot.ts can play it tap by tap.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { copy } from "../../src/copy";
import { createTuGame, replayTu } from "../../src/lib/tu";
import { greedyTu, randomTu } from "../support/tuBot";
import { screensDir } from "./support/screensDir";

test.use({ browserName: "chromium" });

const g = copy.customer.game;
const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const MOCK_PHOTO = /\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/;
const SEED = "seed-tu-e2e";

const COLORS = ["#DCC5BB", "#F0BF45", "#CFDDEA", "#B05219", "#C9D8B6", "#E8B4B8", "#D9C7E8", "#F2E3B3"];
const NAMES = ["奶酥红豆包", "岩烧乳酪包", "肉松包", "可颂", "吐司", "菠萝包", "蛋挞", "泡芙"];
// The first tier has no photo: the first character is drawn instead.
const TIERS = COLORS.map((bg, i) => ({
  id: `t${i}`,
  radius: 0.2,
  points: i * 10,
  imageUrl: i === 0 ? null : `/api/images/mock/t${i}.jpg`,
  color: { bg, ink: "#2A1A12" },
  name: NAMES[i],
}));

const BOARD = {
  week: { start: "2026-10-26T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z" },
  top: [{ rank: 1, nickname: "小面包", wechatMasked: "bu***01", score: 1280 }],
  lastWinner: null,
  allTime: { nickname: "兔兔", wechatMasked: "ra***ab", score: 4000 },
};

interface Api {
  starts: unknown[];
  finishes: { runId: string; taps: { id: number; at: number }[] }[];
  result: { score: number; best: number; rank: number | null; personalBest?: number; newRecord?: boolean };
}

async function mockApi(page: Page): Promise<Api> {
  const api: Api = { starts: [], finishes: [], result: { score: 0, best: 456, rank: 3, personalBest: 900, newRecord: false } };
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: { orderingEnabled: true, products: [], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8, ownerWechatId: "bunbunny_bakes" },
    }),
  );
  await page.route(MOCK_PHOTO, (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/game/tu/leaderboard**", (route) => route.fulfill({ json: BOARD }));
  await page.route("**/api/game/tu/start", (route: Route) => {
    api.starts.push(route.request().postDataJSON());
    return route.fulfill({ json: { runId: `run-${api.starts.length}`, seed: SEED, tiers: TIERS, expiresAt: "2099-01-01T00:00:00Z" } });
  });
  await page.route("**/api/game/tu/finish", (route: Route) => {
    const body = route.request().postDataJSON();
    api.finishes.push(body);
    const score = replayTu(SEED, TIERS, body.taps).score;
    return route.fulfill({ json: { ...api.result, score, week: "2026-10-26" } });
  });
  return api;
}

async function startGame(page: Page) {
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-wechat").fill("bunbunny_fan");
  await page.getByTestId("tu-nickname").fill("小面包");
  await page.getByTestId("tu-start").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
}

const GAP = 170;
async function tapAll(page: Page, ids: number[], each?: () => Promise<void>) {
  for (const id of ids) {
    await page.getByTestId(`tu-tile-${id}`).click();
    await page.waitForTimeout(GAP);
    if (each) await each();
  }
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(screensDir(), `t3_tu_page-${name}.png`) });

test("menu: start and board, prize and rules lines; the title is not in the play screen", async ({ page }) => {
  await mockApi(page);
  await page.goto("/game/tu");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.customer.tu.pageTitle);
  await expect(page.getByTestId("tu-prize-line")).toHaveText(g.prizeLine);
  await expect(page.getByTestId("tu-rules")).toContainText("bunbunny_bakes");
  await expect(page.getByTestId("tu-resume")).toHaveCount(0);
  await shot(page, "menu");
  await page.getByTestId("tu-open-board").click();
  await expect(page.getByTestId("game-all-time")).toContainText("4000");
  await expect(page.getByTestId("game-row")).toHaveCount(1);
  await page.getByTestId("tu-board-close").click();
  await expect(page.getByTestId("tu-menu-start")).toBeVisible();
});

test("form validation, then batch 1: only the visible tiles render, covered ones are dimmed and cannot be tapped", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/game/tu");
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-start").click();
  await expect(page.getByText(g.wechatInvalid)).toBeVisible();
  expect(api.starts).toHaveLength(0);
  await page.getByTestId("tu-wechat").fill("bunbunny_fan");
  await page.getByTestId("tu-nickname").fill("小面包");
  await page.getByTestId("tu-start").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
  expect(api.starts.at(-1)).toEqual({ wechatId: "bunbunny_fan", nickname: "小面包" });
  // Hidden tiles (D128) are not rendered: compare with the engine's visible tiles for this seed.
  const visible = createTuGame({ seed: SEED, tiers: TIERS }).state().tiles.filter((t) => t.visible).length;
  await expect(page.locator('[data-testid^="tu-tile-"]')).toHaveCount(visible);
  await expect(page.getByTestId("tu-batch")).toHaveText("第 1 炉");
  await expect(page.getByTestId("tu-orders").locator('[data-testid^="tu-order-"]')).toHaveCount(2);
  const covered = page.locator('[data-testid^="tu-tile-"][data-free="false"]');
  expect(await covered.count()).toBeGreaterThan(0);
  await expect(covered.first()).toBeDisabled();
  await shot(page, "board");
});

test("tiles are at least 44 px and nothing scrolls sideways at 320 px", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/game/tu");
  await startGame(page);
  const sizes = await page.locator('[data-testid^="tu-tile-"][data-free="true"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
  const board = (await page.getByTestId("tu-board").boundingBox())!;
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(320);
});

test("a tap moves the tile into the bag; a greedy bot packs, fills an order and reaches the next 炉", async ({ page }) => {
  test.setTimeout(240_000);
  await mockApi(page);
  const bot = greedyTu(SEED, TIERS);
  await page.goto("/game/tu");
  await startGame(page);
  await expect(page.getByTestId("tu-bag")).toHaveAttribute("aria-label", /装了 0 个/);

  let sawOrder = false;
  let shotBag = false;
  let sawBatch = false;
  let n = 0;
  for (const tp of bot.taps) {
    await page.getByTestId(`tu-tile-${tp.id}`).click();
    n++;
    await page.waitForTimeout(GAP);
    if (n === 4 && !shotBag) {
      shotBag = true;
      await expect(page.locator('[data-testid^="tu-slot-"][data-tier]').first()).toBeVisible();
      await shot(page, "bag");
    }
    if (!sawOrder && (await page.locator('[data-testid^="tu-order-"][data-done="1"]').count()) > 0) {
      sawOrder = true;
      await shot(page, "order");
    }
    if (await page.getByTestId("tu-banner").count()) {
      sawBatch = true;
      await shot(page, "batch2");
      break;
    }
  }
  expect(sawOrder).toBe(true);
  expect(sawBatch).toBe(true);
  await expect(page.getByTestId("tu-batch")).toHaveText("第 2 炉");
});

test("save and resume: reload, 继续上一局 shows the last score and the same board", async ({ page }) => {
  await mockApi(page);
  const bot = greedyTu(SEED, TIERS);
  await page.goto("/game/tu");
  await startGame(page);
  await tapAll(page, bot.taps.slice(0, 8).map((x) => x.id));
  await page.waitForTimeout(900);
  const flat = async () => (await page.getByTestId("tu-score").innerText()).replace(/\s/g, "");
  const score = await flat();
  const left = await page.locator('[data-testid^="tu-tile-"]').count();
  const bag = await page.getByTestId("tu-bag").getAttribute("aria-label");
  await page.reload();
  await expect(page.getByTestId("tu-resume-score")).toContainText(`${replayTu(SEED, TIERS, bot.taps.slice(0, 8).map((x, i) => ({ id: x.id, at: (i + 1) * 200 }))).score}`);
  await page.getByTestId("tu-resume").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
  await expect(page.locator('[data-testid^="tu-tile-"]')).toHaveCount(left);
  await expect(page.getByTestId("tu-bag")).toHaveAttribute("aria-label", bag!);
  await expect.poll(flat).toBe(score);
  // Play on after the resume.
  await tapAll(page, bot.taps.slice(8, 10).map((x) => x.id));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bb_tu_save_v2")!).taps.length)).toBe(10);
});

test("exit asks: 保存进度再走 keeps the run, 不保存 deletes it; 重新开始 asks first", async ({ page }) => {
  await mockApi(page);
  const bot = greedyTu(SEED, TIERS);
  await page.goto("/game/tu");
  await startGame(page);
  await tapAll(page, bot.taps.slice(0, 3).map((x) => x.id));
  await page.getByTestId("tu-exit").click();
  await page.getByTestId("tu-exit-save").click();
  await expect(page.getByTestId("tu-resume")).toBeVisible();
  await page.getByTestId("tu-restart").click();
  await page.getByTestId("tu-restart-cancel").click();
  await expect(page.getByTestId("tu-resume")).toBeVisible();
  await page.getByTestId("tu-resume").click();
  await page.getByTestId("tu-exit").click();
  await page.getByTestId("tu-exit-discard").click();
  await expect(page.getByTestId("tu-menu-start")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bb_tu_save_v2"))).toBeNull();
});

test("an expired save is not offered", async ({ page }) => {
  await mockApi(page);
  await page.goto("/game/tu");
  await page.evaluate(() =>
    localStorage.setItem("bb_tu_save_v2", JSON.stringify({ v: 1, runId: "x", seed: "s", tiers: new Array(4).fill({}), taps: [{ id: 1, at: 200 }], nickname: "a", expiresAt: "2020-01-01T00:00:00Z", score: 10 })),
  );
  await page.reload();
  await expect(page.getByTestId("tu-menu-start")).toBeVisible();
});

test("a random player runs out of bag: result sheet with the server score, close, bottom bar, reopen, new record", async ({ page }) => {
  test.setTimeout(120_000);
  const api = await mockApi(page);
  api.result = { score: 0, best: 456, rank: 3, personalBest: 900, newRecord: true };
  const bot = randomTu(SEED, TIERS);
  expect(bot.over).toBe(true);
  await page.goto("/game/tu");
  await startGame(page);
  await tapAll(page, bot.taps.map((x) => x.id));
  const sheet = page.getByTestId("tu-over-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("tu-confirmed")).toBeVisible();
  const shown = Number(await page.getByTestId("tu-final-score").innerText());
  expect(shown).toBe(bot.score);
  expect(api.finishes).toHaveLength(1);
  expect(api.finishes[0].taps.map((x) => x.id)).toEqual(bot.taps.map((x) => x.id));
  expect(replayTu(SEED, TIERS, api.finishes[0].taps).over).toBe(true);
  await expect(page.getByTestId("tu-new-record")).toContainText("新纪录");
  await expect(page.getByTestId("tu-personal-best")).toHaveText("900");
  await expect(page.getByTestId("tu-best")).toHaveText("456");
  await shot(page, "result");
  await page.getByTestId("tu-over-close").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("tu-bar")).toBeVisible();
  await expect(page.getByTestId("tu-bag")).toHaveAttribute("data-full", "1");
  await page.getByTestId("tu-bar-score").click();
  await expect(sheet).toBeVisible();
  await page.getByTestId("tu-to-board").click();
  await expect(page.getByTestId("game-all-time")).toBeVisible();
  await page.getByTestId("tu-board-close").click();
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bb_tu_save_v2"))).toBeNull();
});

test("reduced motion: no animation classes on packs", async ({ page }) => {
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bot = greedyTu(SEED, TIERS);
  await page.goto("/game/tu");
  await startGame(page);
  let animated = false;
  await tapAll(page, bot.taps.slice(0, 12).map((x) => x.id), async () => {
    const a = await page.locator(".tu-popping").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    if (a.some((n) => n === "tu-pop")) animated = true;
  });
  expect(animated).toBe(false);
});

test("a saved run that is already over resumes into the result flow and is submitted", async ({ page }) => {
  const api = await mockApi(page);
  const bot = randomTu(SEED, TIERS);
  const taps = bot.taps.map((x, i) => ({ id: x.id, at: (i + 1) * 200 }));
  await page.goto("/game/tu");
  await page.evaluate(
    (save) => localStorage.setItem("bb_tu_save_v2", JSON.stringify(save)),
    { v: 1, runId: "run-over", seed: SEED, tiers: TIERS, taps, nickname: "小面包", expiresAt: "2099-01-01T00:00:00Z", score: bot.score },
  );
  await page.reload();
  await page.getByTestId("tu-resume").click();
  await expect(page.getByTestId("tu-over-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("tu-confirmed")).toBeVisible();
  expect(api.finishes).toHaveLength(1);
  expect(api.finishes[0].runId).toBe("run-over");
  expect(await page.evaluate(() => localStorage.getItem("bb_tu_save_v2"))).toBeNull();
});
