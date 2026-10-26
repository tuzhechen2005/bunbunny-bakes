// L2 (D100-D105): the home entry card and the /game page. Every game API answer is mocked
// (the contract of L1); the engine in the page is whatever src/components/game/engine.ts points at.
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { copy } from "../../src/copy";

test.use({ browserName: "chromium" });

const g = copy.customer.game;
const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const MOCK_PHOTO = /\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/;

const PRODUCTS = [
  { id: "p1", name: "奶酥红豆包", description: null, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p2", name: "岩烧乳酪包", description: null, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
].map((p) => ({ ...p, imageUrl: `/api/images/mock/${p.id}.jpg` }));

// Big pieces so a board fills after a dozen drops.
const TIERS = [
  { id: "t0", radius: 0.14, points: 0, imageUrl: "/api/images/mock/t0.jpg", color: { bg: "#DCC5BB", ink: "#4A2723" } },
  { id: "t1", radius: 0.18, points: 10, imageUrl: "/api/images/mock/t1.jpg", color: { bg: "#F0BF45", ink: "#36260A" } },
  { id: "t2", radius: 0.22, points: 30, imageUrl: "/api/images/mock/t2.jpg", color: { bg: "#CFDDEA", ink: "#1B2C44" } },
  { id: "t3", radius: 0.26, points: 60, imageUrl: "/api/images/mock/t3.jpg", color: { bg: "#B05219", ink: "#FFF8EE" } },
  { id: "big", radius: 0.3, points: 100, imageUrl: "/brand/logo.webp", color: { bg: "#EFE7DA", ink: "#161412" } },
];

const BOARD = {
  week: { start: "2026-10-26T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z" },
  top: [
    { rank: 1, nickname: "小面包", wechatMasked: "bu***01", score: 1280 },
    { rank: 2, nickname: "兔兔", wechatMasked: "ra***ab", score: 900 },
  ],
  lastWinner: { nickname: "老王", wechatMasked: "wa***99", score: 2000 },
};

interface Api {
  starts: unknown[];
  finishes: { runId: string; drops: { x: number; at: number }[] }[];
  failFinishOnce: boolean;
  startError: { status: number; body: unknown } | null;
}

async function mockApi(page: Page, board: object | number = BOARD): Promise<Api> {
  const api: Api = { starts: [], finishes: [], failFinishOnce: false, startError: null };
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: { orderingEnabled: true, products: PRODUCTS, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8, ownerWechatId: "bunbunny_bakes" },
    }),
  );
  await page.route(MOCK_PHOTO, (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/game/leaderboard**", (route) =>
    typeof board === "number" ? route.fulfill({ status: board, json: { error: "NOT_FOUND", message: "x" } }) : route.fulfill({ json: board }),
  );
  await page.route("**/api/game/start", (route: Route) => {
    api.starts.push(route.request().postDataJSON());
    if (api.startError) return route.fulfill({ status: api.startError.status, json: api.startError.body });
    return route.fulfill({ json: { runId: `run-${api.starts.length}`, seed: "seed-e2e", tiers: TIERS, expiresAt: "2099-01-01T00:00:00Z" } });
  });
  await page.route("**/api/game/finish", (route: Route) => {
    if (api.failFinishOnce) {
      api.failFinishOnce = false;
      return route.abort("failed");
    }
    api.finishes.push(route.request().postDataJSON());
    return route.fulfill({ json: { score: 123, best: 456, rank: 3, week: "2026-10-26" } });
  });
  return api;
}

async function startGame(page: Page, wechat = "bunbunny_fan", nick = "小面包") {
  await page.getByTestId("game-wechat").fill(wechat);
  await page.getByTestId("game-nickname").fill(nick);
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
}

/** Clicks the board at fractions of its width until the over sheet shows (a drop per 280 ms: the cool-down is 250 ms). */
async function playUntilOver(page: Page) {
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  const xs = [0.2, 0.5, 0.8, 0.35, 0.65];
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("game-over-sheet").isVisible()) return;
    await page.mouse.click(box.x + box.width * xs[i % xs.length], box.y + box.height * 0.3);
    await page.waitForTimeout(280);
  }
  await expect(page.getByTestId("game-over-sheet")).toBeVisible({ timeout: 15_000 });
}

test("home entry card: neutral line without scores, best score with them, opens /game", async ({ page }) => {
  await mockApi(page, 404);
  // The card breathes, which Playwright reads as "not stable": click it the way a reduced-motion user sees it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.getByTestId("game-entry");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText(g.title);
  await expect(page.getByTestId("game-entry-line")).toHaveText(g.entryNeutral);
  // Below the product list.
  const listBottom = await page.locator(".hm-grid").evaluate((e) => e.getBoundingClientRect().bottom);
  const cardTop = await card.evaluate((e) => e.getBoundingClientRect().top);
  expect(cardTop).toBeGreaterThan(listBottom);
  await card.click();
  await expect(page).toHaveURL(/\/game$/);
});

test("home entry card shows the week's best and breathes unless motion is reduced", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByTestId("game-entry-line")).toContainText(`${g.entryBest} 1280`);
  const anim = await page.getByTestId("game-entry").evaluate((e) => getComputedStyle(e).animationName);
  expect(anim).toBe("game-breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await page.getByTestId("game-entry").evaluate((e) => getComputedStyle(e).animationName);
  expect(still).toBe("none");
});

test("the leaderboard is not fetched before the card is near the screen", async ({ page }) => {
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const many = Array.from({ length: 10 }, (_, i) => ({ ...PRODUCTS[i % 2], id: `p${i}`, name: `面包${i}` }));
  await page.route("**/api/menu", (route) =>
    route.fulfill({ json: { orderingEnabled: true, products: many, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 } }),
  );
  let asked = 0;
  await page.route("**/api/game/leaderboard**", (route) => {
    asked++;
    return route.fulfill({ json: BOARD });
  });
  await page.goto("/");
  await page.waitForTimeout(1500);
  expect(asked).toBe(0);
  await page.getByTestId("game-entry").scrollIntoViewIfNeeded();
  await expect.poll(() => asked).toBeGreaterThan(0);
});

test("start form: validation, rules line with the owner WeChat, remembered values, banned message", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/game");
  await expect(page.getByTestId("game-rules")).toContainText("bunbunny_bakes");
  await page.getByTestId("game-start").click();
  await expect(page.getByText(g.wechatInvalid)).toBeVisible();
  await expect(page.getByText(g.nicknameInvalid)).toBeVisible();
  expect(api.starts).toHaveLength(0);
  await page.getByTestId("game-wechat").fill("bunbunny_fan");
  await page.getByTestId("game-nickname").fill("这个昵称实在是太长了超过十个字");
  await page.getByTestId("game-start").click();
  await expect(page.getByText(g.nicknameInvalid)).toBeVisible();

  api.startError = { status: 403, body: { error: "BANNED", message: "这个微信号暂时不能参加" } };
  await page.getByTestId("game-nickname").fill("  小面包 ");
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-form-error")).toHaveText("这个微信号暂时不能参加");

  api.startError = null;
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  expect(api.starts.at(-1)).toEqual({ wechatId: "bunbunny_fan", nickname: "小面包" });

  await page.reload();
  await expect(page.getByTestId("game-wechat")).toHaveValue("bunbunny_fan");
  await expect(page.getByTestId("game-nickname")).toHaveValue("小面包");
});

test("sound toggle is remembered and defaults to off", async ({ page }) => {
  await mockApi(page);
  await page.goto("/game");
  const btn = page.getByTestId("game-sound");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByTestId("game-sound")).toHaveAttribute("aria-pressed", "true");
});

test("play to game over: the drop log is valid, a failed submit can be retried with the same run", async ({ page }) => {
  test.setTimeout(120_000);
  const api = await mockApi(page);
  api.failFinishOnce = true;
  await page.goto("/game");
  await startGame(page);
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "0");
  await playUntilOver(page);

  // Nothing is claimed about the board until the server answered; the retry button shows.
  await expect(page.getByTestId("game-retry")).toBeVisible();
  await expect(page.getByTestId("game-confirmed")).toHaveCount(0);
  await page.getByTestId("game-retry").click();
  await expect(page.getByTestId("game-confirmed")).toBeVisible();
  await expect(page.getByTestId("game-best")).toHaveText("456");

  expect(api.finishes).toHaveLength(1);
  const { runId, drops } = api.finishes[0];
  expect(runId).toBe("run-1");
  expect(drops.length).toBeGreaterThan(3);
  for (let i = 0; i < drops.length; i++) {
    expect(drops[i].x).toBeGreaterThanOrEqual(0);
    expect(drops[i].x).toBeLessThanOrEqual(1);
    expect(Number.isInteger(drops[i].at)).toBe(true);
    if (i > 0) expect(drops[i].at - drops[i - 1].at).toBeGreaterThanOrEqual(30);
  }
  const shown = Number(await page.getByTestId("game-final-score").innerText());
  expect(shown).toBeGreaterThanOrEqual(0);

  // Another round: a new run, a fresh board.
  await page.getByTestId("game-again").click();
  await expect(page.getByTestId("game-over-sheet")).toHaveCount(0);
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "0");
  expect(api.starts).toHaveLength(2);
});

test("touch: press, drag to aim and release drops one piece; the cool-down blocks a second one", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/game");
  await startGame(page);
  await page.waitForTimeout(400);
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height * 0.4;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", box.x + box.width * 0.3);
  for (let i = 1; i <= 6; i++) await touch("touchMove", box.x + box.width * (0.3 + i * 0.05));
  await touch("touchEnd", box.x + box.width * 0.6);
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "1");
  // Immediately again: inside the cool-down, ignored.
  await touch("touchStart", box.x + box.width * 0.5);
  await touch("touchEnd", box.x + box.width * 0.5);
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "1");
  await page.waitForTimeout(400);
  await touch("touchStart", box.x + box.width * 0.5);
  await touch("touchEnd", box.x + box.width * 0.5);
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "2");
  expect(api.finishes).toHaveLength(0);
});

test("leaderboard view: top list, last winner, my best", async ({ page }) => {
  await mockApi(page, { ...BOARD, myBest: 777 });
  await page.goto("/game");
  await page.getByTestId("game-open-board").click();
  await expect(page.getByTestId("game-row")).toHaveCount(2);
  await expect(page.getByTestId("game-row").first()).toContainText("bu***01");
  await expect(page.getByTestId("game-last-winner")).toContainText("老王");
  await expect(page.getByTestId("game-my-best")).toContainText("777");
  await page.getByTestId("game-board-close").click();
  await expect(page.getByTestId("game-start")).toBeVisible();
});

test("320 px: the start screen and the board do not scroll sideways", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/game");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await startGame(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const b = (await page.getByTestId("game-board").boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(320);
  expect(b.y + b.height).toBeLessThanOrEqual(640);
});
