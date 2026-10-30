// S4 (D134): one home entry leading to the game hub, and the admin game switch.
// The second game's API (T2) is mocked with route interception until it lands.
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, resetAndSeed, withDb } from "./support/seed";

test.use({ browserName: "chromium" });

import { hubFixture } from "./support/gameHub";

const g = copy.customer.game;
const a = copy.admin.game;
const SCREENS = process.env.SCREENS_DIR ?? "test-results/screens";

const PRODUCTS = [
  { id: "p1", name: "奶酥红豆包", description: null, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1, imageUrl: null },
];

async function mockHome(page: Page, opts: { big?: number | null; tu?: number | null } = {}) {
  const asked: string[] = [];
  await page.route("**/api/menu", (route) =>
    route.fulfill({ json: { orderingEnabled: true, products: PRODUCTS, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8, ownerWechatId: "x" } }),
  );
  await page.route("**/api/game/hub", (r) => { asked.push("hub"); return r.fulfill({ json: hubFixture("TU", opts.big ?? null, opts.tu ?? null) }); });
  return asked;
}

test("home card: one link, the weekly prize game, and the original heartbeat", async ({ page }) => {
  const asked = await mockHome(page, { big: 1280, tu: 640 });
  await page.goto("/");
  await page.getByTestId("game-entry-card").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("game-entry")).toContainText(copy.customer.gameHub.title);
  await expect(page.getByTestId("game-entry-line")).toContainText(copy.customer.tu.title);
  await expect(page.getByTestId("game-entry-prize")).toHaveCount(1);
  await expect(page.getByTestId("game-entry")).toHaveAttribute("href", "/game/hub");
  expect(asked).toEqual(["hub"]);
  expect(await page.getByTestId("game-entry").evaluate((e) => getComputedStyle(e).animationName)).toBe("game-breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.getByTestId("game-entry").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("home card: failures keep the neutral line and the link still opens the hub", async ({ page }) => {
  await mockHome(page);
  await page.route("**/api/game/hub", (r) => r.fulfill({ status: 500, json: { error: "X" } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByTestId("game-entry-card").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("game-entry-line")).toHaveText(g.entryNeutral);
  await page.getByTestId("game-entry").click();
  await expect(page).toHaveURL(/\/game\/hub$/);
});

for (const width of [390, 320]) {
  test(`home card at ${width}px: no horizontal scroll, target >= 44px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockHome(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const card = page.getByTestId("game-entry-card");
    await card.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("game-entry-line")).toContainText(copy.customer.tu.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const b = (await page.getByTestId("game-entry").boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
    await card.screenshot({ path: `${SCREENS}/s4-home-${width}.png` });
  });
}

const TU_BOARD = {
  week: "2026-10-26",
  currentWeek: "2026-10-26",
  weeks: ["2026-10-26"],
  rows: [{ id: "r1", wechatId: "tu_fan", nickname: "兔兔", score: 777, finishedAt: "2026-10-27T15:00:00Z", verified: true, hidden: false, banned: false, ordered: false, dropCount: 30, durationSec: 90, rank: 1 }],
  winner: null,
  bans: [],
};

test("admin: game switch loads the other game's board with ?game=tu and keeps 面包 shared", async ({ page, context, baseURL }) => {
  await resetAndSeed();
  await withDb(async (c) => {
    await c.query(`TRUNCATE "GameTier","GameRun","GameBan","GameAward"`);
  });
  const calls: string[] = [];
  await page.route("**/api/admin/game/leaderboard**", (route) => {
    const u = new URL(route.request().url());
    calls.push(u.searchParams.get("game") ?? "");
    if (u.searchParams.get("game") === "tu") return route.fulfill({ json: TU_BOARD });
    return route.continue();
  });
  const token = await createAdminSession("e2e-t4");
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL! }]);
  await page.goto("/admin/game");
  await expect(page.getByTestId("board-empty")).toBeVisible();
  await expect(page.getByTestId("game-switch-big")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("game-switch-tu").click();
  await expect(page.getByTestId("run-row")).toContainText("tu_fan");
  await expect(page.getByTestId("game-switch-tu")).toHaveAttribute("aria-checked", "true");
  expect(calls).toEqual(["", "tu"]);
  // the hide button writes to the same game
  const writes: string[] = [];
  await page.route("**/api/admin/game/runs/**", (r) => { writes.push(r.request().url()); return r.fulfill({ json: { ok: true } }); });
  await page.getByTestId("run-hide").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toContain("game=tu");
  // switching back returns the first game's (empty) board; the 面包 tab has no switch
  await page.getByTestId("game-switch-big").click();
  await expect(page.getByTestId("board-empty")).toBeVisible();
  await page.getByTestId("game-tab-tiers").click();
  await expect(page.getByTestId("game-switch")).toHaveCount(0);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByTestId("game-tab-board").click();
    await page.getByTestId("game-switch-tu").click();
    await expect(page.getByTestId("run-row")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const b = (await page.getByTestId("game-switch-tu").boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SCREENS}/t4_tu_home_admin-admin-${width}.png` });
  }
  expect(a.gameTu).toBe("兔了个兔");
});
