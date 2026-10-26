// M1 (D107): game-only pieces. Admin adds three named, coloured pieces next to five menu products
// (8 tiers + 大面包), uploads a picture to one, reorders; the customer game then starts with those
// tiers, draws the picture-less pieces as a colour circle with the first character, and a full game
// still finishes and is confirmed by the server. Real backend, *_test database.

import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, resetAndSeed, withDb } from "./support/seed";

test.use({ browserName: "chromium" });

const t = copy.admin.game;
const g = copy.customer.game;
const SCREENS = process.env.SCREENS_DIR ?? "test-results/screens";

async function addPiece(page: Page, name: string, hex: string) {
  await page.getByTestId("piece-add").click();
  await page.getByTestId("piece-form-name").fill(name);
  await page.getByTestId(`color-swatch-${hex.slice(1)}`).click();
  await page.getByTestId("piece-form-submit").click();
  await expect(page.getByTestId("piece-form")).toHaveCount(0);
}

test("owner adds game-only pieces, then a customer plays a full game on 8 tiers", async ({ page, context, baseURL }) => {
  test.setTimeout(300_000);
  await resetAndSeed();
  await withDb(async (c) => {
    await c.query(`TRUNCATE "GameTier","GameRun","GameBan","GameAward"`);
    await c.query(
      `INSERT INTO "Product" (id, name, description, "unitPriceCents", "capacityMode", "dailyLimit", "batchYield", "leadDays", "sortOrder", "updatedAt")
       VALUES (gen_random_uuid(), '巧克力奶酥吐司', 'x', 399, 'INDEPENDENT', 10, 1, 1, 5, now())`,
    );
  });
  const token = await createAdminSession("e2e-m1");
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL! }]);
  await page.goto("/admin/game");
  await page.getByText(t.tabTiers, { exact: true }).click();
  await page.getByTestId("tiers-init").click();
  await expect(page.getByTestId("tier-3")).toBeVisible();

  await expect(page.getByTestId("tier-4")).toContainText("巧克力奶酥吐司"); // five menu products

  // validation: the 添加 button needs a name
  await page.getByTestId("piece-add").click();
  await expect(page.getByTestId("piece-form-submit")).toBeDisabled();
  await page.getByTestId("piece-form-name").fill("泡芙");
  await expect(page.getByTestId("color-field")).toBeVisible();
  await page.getByTestId("piece-form-submit").click();
  await expect(page.getByTestId("tier-5")).toContainText("泡芙");
  await expect(page.getByTestId("tier-gameonly-5")).toHaveText(t.gameOnlyTag);

  await addPiece(page, "冰面包", "#CFDDEA");
  await addPiece(page, "白色恋人", "#EFE7DA");
  await expect(page.getByTestId("tier-7")).toContainText("白色恋人");
  await expect(page.getByText(t.maxTiers)).toBeVisible();
  await expect(page.getByTestId("piece-add")).toHaveCount(0);

  // edit the first piece's look
  await page.getByTestId("tier-look-edit-5").click();
  await page.getByTestId("tier-look-5-name").fill("奶油泡芙");
  await page.getByTestId("color-swatch-F0BF45").click();
  await page.getByTestId("tier-look-5-submit").click();
  await expect(page.getByTestId("tier-name-5")).toHaveText("奶油泡芙");

  // upload a picture for the last piece
  await page.locator('[data-testid^="tier-image-edit-"]').nth(7).click();
  await page.getByTestId("tier-image-input").setInputFiles("tests/fixtures/tier-white.png");
  await expect(page.getByTestId("tier-image-preview")).toBeVisible();
  await page.getByTestId("tier-image-save").click();
  await expect(page.getByTestId("tier-image-editor")).toHaveCount(0);

  // reorder: move the last piece up one
  await page.getByRole("button", { name: `${t.moveUp} 白色恋人` }).click();
  await expect(page.getByTestId("tier-6")).toContainText("白色恋人");
  await expect(page.getByTestId("tier-big")).toContainText(t.bigName);
  await page.screenshot({ path: `${SCREENS}/m1-admin-tiers.png`, fullPage: true });

  // customer: the game starts with 8 tiers + the big one
  const started = page.waitForResponse((r) => r.url().endsWith("/api/game/start") && r.request().method() === "POST");
  await page.goto("/game");
  await page.getByTestId("game-wechat").fill("m1_player");
  await page.getByTestId("game-nickname").fill("试玩");
  await page.getByTestId("game-start").click();
  const body = await (await started).json();
  expect(body.tiers).toHaveLength(9);
  expect(body.tiers.map((x: { name: string }) => x.name).slice(5)).toEqual(["奶油泡芙", "白色恋人", "冰面包", "兔的大面包"]);
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/m1-board.png` });

  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  const xs = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.15, 0.85];
  const sheet = page.getByTestId("game-over-sheet");
  for (let i = 0; i < 400 && !(await sheet.isVisible()); i++) {
    await page.mouse.click(box.x + box.width * xs[i % xs.length], box.y + box.height * 0.3);
    await page.waitForTimeout(270);
  }
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("game-confirmed")).toContainText(g.confirmed, { timeout: 20_000 });
});
