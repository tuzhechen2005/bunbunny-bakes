// Admin 游戏 page e2e: leaderboard moderation (hide, ban, winner card toggles, 下过单 badge) and the
// tier editor (defaults, reorder, remove with the minimum of 2, image upload with white-background
// removal / existing alpha / refused fake checkerboard). Real backend, *_test database.

import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { addDays, chicagoToday, createAdminSession, insertOrder, ITEM, resetAndSeed, withDb } from "./support/seed";

const t = copy.admin.game;
const SCREENS = process.env.SCREENS_DIR ?? "test-results/screens";

function weekKey(): string {
  const today = chicagoToday();
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  return addDays(today, -((dow + 6) % 7));
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function seedGame() {
  const seeded = await resetAndSeed();
  await withDb(async (c) => {
    await c.query(`TRUNCATE "GameTier","GameRun","GameBan","GameAward"`);
  });
  return seeded;
}

async function addRun(wechatId: string, nickname: string, score: number, minutesAgo: number) {
  await withDb((c) =>
    c.query(
      `INSERT INTO "GameRun" ("seed","wechatId","nickname","tiersSnapshot","score","weekKey","finishedAt","dropCount","simSteps") VALUES ('s',$1,$2,'[]'::jsonb,$3,$4, now() - ($5 || ' minutes')::interval, 42, 3600)`,
      [wechatId, nickname, score, weekKey(), String(minutesAgo)],
    ),
  );
}

async function login(page: Page, context: import("@playwright/test").BrowserContext, baseURL: string) {
  const token = await createAdminSession("e2e-game");
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
  await page.goto("/admin/game");
}

test("unauthenticated /admin/game redirects to login", async ({ page }) => {
  await page.goto("/admin/game");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("leaderboard: ranks, 下过单 badge, hide, ban, winner card", async ({ page, context, baseURL }) => {
  const seeded = await seedGame();
  await insertOrder({ date: seeded.dates.d1, wechatId: "Alice_W", status: "COMPLETED", items: [ITEM.red(seeded.products.red, 1)] });
  await addRun("alice_w", "艾丽", 900, 3);
  await addRun("bob_w", "鲍勃", 700, 2);
  await addRun("cara_w", "卡拉", 300, 1);
  await login(page, context, baseURL!);

  const rows = page.getByTestId("run-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("alice_w");
  await expect(rows.first().getByTestId("run-ordered")).toHaveText(t.ordered);
  await expect(rows.first().getByTestId("run-evidence")).toContainText("42 次落子 · 30 秒");
  await expect(rows.nth(1).getByTestId("run-ordered")).toHaveText(t.notOrdered);
  await expect(page.getByTestId("winner-card")).toContainText("艾丽");
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-board.png`, fullPage: true });

  // hide the leader: bob becomes the winner
  await rows.first().getByTestId("run-hide").click();
  await expect(page.getByTestId("winner-card")).toContainText("鲍勃");
  await expect(rows.first().getByTestId("run-unhide")).toBeVisible();
  await rows.first().getByTestId("run-unhide").click();
  await expect(page.getByTestId("winner-card")).toContainText("艾丽");

  // ban bob with a reason
  await rows.nth(1).getByTestId("run-ban").click();
  await page.getByTestId("ban-reason").fill("脚本刷分");
  await page.getByTestId("ban-submit").click();
  await expect(page.getByTestId("bans-list")).toContainText("bob_w");
  await expect(page.getByTestId("bans-list")).toContainText("脚本刷分");
  await expect(rows.nth(1)).toContainText(t.banned);
  await page.getByTestId("ban-remove").click();
  await expect(page.getByTestId("bans-empty")).toBeVisible();

  // winner toggles persist across a reload
  await page.getByTestId("award-contacted").click();
  await expect(page.getByTestId("award-contacted")).toBeChecked();
  await page.getByTestId("award-note").fill("面包券一张");
  await page.getByTestId("award-note-save").click();
  await expect(page.getByText(t.noteSaved)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("award-contacted")).toBeChecked();
  await expect(page.getByTestId("award-redeemed")).not.toBeChecked();
  await expect(page.getByTestId("award-note")).toHaveValue("面包券一张");

  const logged = await withDb((c) => c.query(`SELECT action FROM "AuditLog" WHERE action LIKE 'game.%' ORDER BY at`));
  expect(logged.rows.map((r) => r.action)).toEqual([
    "game.run.hide", "game.run.unhide", "game.ban", "game.unban", "game.award", "game.award",
  ]);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.reload();
  await expect(page.getByTestId("winner-card")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-board-320.png`, fullPage: true });
});

test("tiers: defaults, remove down to 2, reorder, image upload variants", async ({ page, context, baseURL }) => {
  await seedGame();
  await login(page, context, baseURL!);
  await page.getByTestId("game-tab-tiers").click();
  await expect(page.getByTestId("tiers-init")).toBeVisible();
  await expect(page.getByTestId("tier-3")).toContainText("焦糖布蕾");
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-tiers-default.png`, fullPage: true });

  await page.getByTestId("tiers-init").click();
  await expect(page.getByTestId("tiers-init")).toHaveCount(0);
  await expect(page.getByTestId("tier-0")).toContainText("奶酥红豆包");

  // reorder: move the second tier up
  await page.getByRole("button", { name: `${t.moveUp} 岩烧乳酪包` }).click();
  await expect(page.getByTestId("tier-0").locator("option:checked")).toHaveText("岩烧乳酪包");

  // remove down to 2; the last remove button is disabled
  for (let i = 0; i < 2; i++) {
    await page.getByTestId(`tier-remove-${3 - i}`).click();
    await page.getByTestId("tier-remove-yes").click();
  }
  await expect(page.getByTestId("tier-1")).toBeVisible();
  await expect(page.getByTestId("tier-2")).toHaveCount(0);
  await expect(page.getByTestId("tier-remove-0")).toBeDisabled();
  await expect(page.getByTestId("tier-add-select")).toBeVisible();
  await page.getByTestId("tier-add-select").selectOption({ label: "焦糖布蕾" });
  await page.getByTestId("tier-add").click();
  await expect(page.getByTestId("tier-2")).toContainText("焦糖布蕾");

  // image: white background -> removed, preview on the tier colour, saved
  const tierId = async () => (await page.locator('[data-testid^="tier-image-edit-"]').first().getAttribute("data-testid"))!.replace("tier-image-edit-", "");
  const id0 = await tierId();
  await page.getByTestId(`tier-image-edit-${id0}`).click();
  await page.getByTestId("tier-image-input").setInputFiles("tests/fixtures/tier-white.png");
  await expect(page.getByTestId("tier-image-hint")).toHaveText(t.imageHintWhite);
  await expect(page.getByTestId("tier-image-preview")).toBeVisible();
  // the processed preview has transparent corners
  const corner = await page.evaluate(async () => {
    const img = document.querySelector('[data-testid="tier-image-preview"] img') as HTMLImageElement;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return { corner: ctx.getImageData(1, 1, 1, 1).data[3], centre: ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data[3] };
  });
  expect(corner).toEqual({ corner: 0, centre: 255 });
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-tier-editor.png`, fullPage: true });
  await page.getByTestId("tier-image-save").click();
  await expect(page.getByTestId("tier-image-editor")).toHaveCount(0);
  await expect(page.getByTestId(`tier-image-delete-${id0}`)).toBeVisible();

  // image that is already transparent: used as is
  await page.getByTestId(`tier-image-edit-${id0}`).click();
  await page.getByTestId("tier-image-input").setInputFiles("tests/fixtures/tier-alpha.png");
  await expect(page.getByTestId("tier-image-hint")).toHaveText(t.imageHintAlpha);
  await expect(page.getByTestId("tier-remove-white")).toHaveCount(0);

  // painted checkerboard: refused, cannot be saved
  await page.getByTestId("tier-image-input").setInputFiles("tests/fixtures/tier-checker.png");
  await expect(page.getByTestId("tier-image-hint")).toHaveText(t.imageHintFake);
  await expect(page.getByTestId("tier-image-save")).toBeDisabled();
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-tier-fake.png`, fullPage: true });
  await page.getByRole("button", { name: t.imageCancel }).click();

  // delete the image
  await page.getByTestId(`tier-image-delete-${id0}`).click();
  await expect(page.getByTestId(`tier-image-delete-${id0}`)).toHaveCount(0);

  // the big tier is last and fixed; 320 px has no horizontal scroll
  await expect(page.getByTestId("tier-big")).toContainText(t.bigName);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SCREENS}/l3_admin_game-tiers-320.png`, fullPage: true });
});
