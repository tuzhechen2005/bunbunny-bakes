import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { hubFixture } from "./support/gameHub";
import { createAdminSession, resetAndSeed } from "./support/seed";

const t = copy.customer.gameHub;
const g = copy.customer.game;
test.use({ browserName: "chromium" });

for (const width of [320, 390]) {
  test(`hub at ${width}px: two columns, scores, one prize badge, working links`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/game/hub", (r) => r.fulfill({ json: hubFixture("TU", 0, 640) }));
    await page.goto("/game/hub");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
    const big = page.getByTestId("hub-game-big");
    const tu = page.getByTestId("hub-game-tu");
    await expect(big.getByTestId("hub-best")).toHaveText(`${g.entryBest} 0`);
    await expect(tu.getByTestId("hub-best")).toHaveText(`${g.entryBest} 640`);
    await expect(page.getByTestId("hub-prize")).toHaveCount(1);
    await expect(tu.getByTestId("hub-prize")).toHaveText(t.prizeBadge);
    await expect(big).toHaveAttribute("href", "/game");
    await expect(tu).toHaveAttribute("href", "/game/tu");
    const a = (await big.boundingBox())!;
    const b = (await tu.boundingBox())!;
    expect(a.y).toBe(b.y);
    expect(b.x).toBeGreaterThan(a.x);
    for (const box of [a, b]) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await tu.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/game\/tu$/);
    await expect(page.getByTestId("top-bar-back")).toHaveAttribute("href", "/game/hub");
    await page.getByTestId("top-bar-back").click();
    await big.click();
    await expect(page).toHaveURL(/\/game$/);
  });
}

test("hub: empty scores and an API failure with retry; game links remain usable", async ({ page }) => {
  let fail = true;
  await page.route("**/api/game/hub", (r) => fail ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: hubFixture("BIG", null, null) }));
  await page.goto("/game/hub");
  await expect(page.getByTestId("hub-game-big")).toBeVisible();
  await expect(page.getByRole("button", { name: g.retry })).toBeVisible();
  await expect(page.getByTestId("hub-prize")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: g.retry }).click();
  await expect(page.getByTestId("hub-game-big").getByTestId("hub-prize")).toBeVisible();
  await expect(page.getByTestId("hub-best").first()).toHaveText(t.emptyBest);
});

for (const prizeGame of ["BIG", "TU"] as const) {
  test(`only ${prizeGame} shows prize lines, eligibility and the leaderboard gift`, async ({ page }) => {
    await page.route("**/api/game/hub", (r) => r.fulfill({ json: hubFixture(prizeGame) }));
    await page.route("**/api/menu", (r) => r.fulfill({ json: { products: [], ownerWechatId: "test_owner" } }));
    await page.route(/\/api\/game\/(tu\/)?leaderboard/, (r) => r.fulfill({ json: {
      week: { start: "2026-10-26", end: "2026-11-01" }, top: [{ rank: 1, nickname: "兔", wechatMasked: "t***", score: 10 }], lastWinner: null,
    } }));
    for (const [kind, href, id] of [["BIG", "/game", "game"], ["TU", "/game/tu", "tu"]] as const) {
      const loaded = page.waitForResponse("**/api/game/hub");
      await page.goto(href);
      await loaded;
      if (kind === prizeGame) {
        await expect(page.getByTestId(`${id}-prize-line`)).toHaveText(g.prizeLine);
        await expect(page.getByTestId(`${id}-rules`)).toContainText("test_owner");
      } else {
        await expect(page.getByTestId(`${id}-prize-line`)).toHaveCount(0);
        await expect(page.getByTestId(`${id}-rules`)).toHaveText(t.rules);
      }
      await page.getByTestId(`${id}-open-board`).click();
      await expect(page.getByTestId("game-row")).toHaveCount(1);
      await expect(page.getByTestId("game-prize-mark")).toHaveCount(kind === prizeGame ? 1 : 0);
    }
  });
}

for (const width of [320, 390]) {
  for (const [kind, href, id] of [["BIG", "/game", "game"], ["TU", "/game/tu", "tu"]] as const) {
    test(`${kind} at ${width}px: delayed and failed hub requests keep the menu stable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.clock.setFixedTime(new Date("2026-10-30T12:00:00Z"));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route("**/api/menu", (r) => r.fulfill({ json: { products: [] } }));
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      let requests = 0;
      await page.route("**/api/game/hub", async (r) => {
        requests++;
        if (requests === 1) {
          await pending;
          await r.fulfill({ json: hubFixture(kind) });
        } else {
          await r.fulfill({ status: 500, json: {} });
        }
      });
      await page.goto(href);
      await expect.poll(() => requests).toBe(1);
      await page.evaluate(() => document.fonts.ready);
      const start = page.getByTestId(`${id}-menu-start`);
      const before = await start.boundingBox();
      await expect(page.getByTestId(`${id}-prize-line`)).toHaveCount(0);
      release();
      await expect(page.getByTestId(`${id}-prize-line`)).toBeVisible();
      expect(await start.boundingBox()).toEqual(before);

      const failed = page.waitForResponse("**/api/game/hub");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await failed;
      await expect(page.getByTestId(`${id}-prize-line`)).toBeVisible();
      expect(await start.boundingBox()).toEqual(before);

      // A failed refresh in a new week must not keep advertising last week's prize.
      await page.clock.setFixedTime(new Date("2026-11-02T12:00:00Z"));
      const nextWeekFailure = page.waitForResponse("**/api/game/hub");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await nextWeekFailure;
      await expect(page.getByTestId(`${id}-prize-line`)).toHaveCount(0);
      expect(await start.boundingBox()).toEqual(before);

      // A fresh visit with no confirmed prize still leaves a usable, stable menu.
      const freshFailure = page.waitForResponse("**/api/game/hub");
      await page.reload();
      await freshFailure;
      await expect(page.getByTestId(`${id}-prize-line`)).toHaveCount(0);
      expect(await start.boundingBox()).toEqual(before);
      await start.click();
      await expect(start).toHaveCount(0);
    });
  }
}

test("owner override updates the hub and persists after reload", async ({ page, context, baseURL }) => {
  await resetAndSeed();
  const token = await createAdminSession("e2e-s4");
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL! }]);
  await page.goto("/admin/game");
  const select = page.getByTestId("prize-game-select");
  await expect(select).toBeEnabled();
  const next = await select.inputValue() === "BIG" ? "TU" : "BIG";
  await select.selectOption(next);
  await expect(page.getByTestId("prize-panel").getByRole("status")).toHaveText(copy.admin.game.prizeSaved);
  await page.reload();
  await expect(select).toHaveValue(next);
  await page.goto("/game/hub");
  await expect(page.getByTestId(`hub-game-${next.toLowerCase()}`).getByTestId("hub-prize")).toBeVisible();
});
