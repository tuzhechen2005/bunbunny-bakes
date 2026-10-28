// T6 (D128, contract C7): hidden tiles are not in the DOM; a `reveal` event pops them in.
// The engine is scripted through the page's test seam (globalThis.__tuEngine) so this runs before and after T5.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { screensDir } from "./support/screensDir";

test.use({ browserName: "chromium" });

const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const TIERS = ["#DCC5BB", "#F0BF45", "#CFDDEA", "#B05219"].map((bg, i) => ({
  id: `t${i}`,
  radius: 0.2,
  points: i * 10,
  imageUrl: i === 0 ? null : `/api/images/mock/t${i}.jpg`,
  color: { bg, ink: "#2A1A12" },
  name: ["奶酥红豆包", "岩烧乳酪包", "肉松包", "可颂"][i],
}));

async function setup(page: Page) {
  await page.route("**/api/menu", (r) =>
    r.fulfill({ json: { orderingEnabled: true, products: [], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8, ownerWechatId: "bunbunny_bakes" } }),
  );
  await page.route(/\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/, (r) => r.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/game/tu/leaderboard**", (r) =>
    r.fulfill({ json: { week: { start: "2026-10-26T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z" }, top: [], lastWinner: null, allTime: null } }),
  );
  await page.route("**/api/game/tu/start", (r) => r.fulfill({ json: { runId: "r1", seed: "s", tiers: TIERS, expiresAt: "2099-01-01T00:00:00Z" } }));
  await page.addInitScript(() => {
    // Tile 1 (tier 0) sits exactly under tile 2 (tier 1): hidden. Tile 3 stands alone. Tapping 2 reveals 1.
    (globalThis as unknown as { __tuEngine: unknown }).__tuEngine = () => {
      const board = [
        { id: 1, tier: 0, x: 0, y: 0, layer: 0, free: false, visible: false },
        { id: 2, tier: 1, x: 0, y: 0, layer: 1, free: true, visible: true },
        { id: 3, tier: 2, x: 2, y: 0, layer: 0, free: true, visible: true },
      ];
      const bag: number[] = [];
      return {
        over: false,
        score: 0,
        batch: 1,
        taps: 0,
        state() {
          return { batch: 1, tiles: board.map((t) => ({ ...t })), bag: [...bag], orders: [0, 2], score: 0, over: false };
        },
        tap(id: number) {
          const i = board.findIndex((t) => t.id === id);
          if (i < 0 || !board[i].free) return null;
          const [t] = board.splice(i, 1);
          bag.push(t.tier);
          const ev: unknown[] = [{ type: "move", tile: id, tier: t.tier, slot: bag.length - 1 }];
          if (id === 2) {
            Object.assign(board[0], { visible: true, free: true });
            ev.push({ type: "reveal", tiles: [1] });
          }
          return ev;
        },
      };
    };
  });
  await page.goto("/game/tu");
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-wechat").fill("bunbunny_fan");
  await page.getByTestId("tu-nickname").fill("小面包");
  await page.getByTestId("tu-start").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
}

test("hidden tiles are not in the DOM; a reveal pops the tile in and it can be tapped", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tu-tile-1")).toHaveCount(0);
  await expect(page.getByTestId("tu-tile-2")).toBeVisible();
  await expect(page.getByTestId("tu-tile-3")).toBeVisible();
  await page.getByTestId("tu-tile-2").click();
  const revealed = page.getByTestId("tu-tile-1");
  await expect(revealed).toBeVisible();
  await expect(revealed).toHaveClass(/tu-reveal/);
  await expect(revealed).toHaveAttribute("data-free", "true");
  const dur = await revealed.evaluate((e) => parseFloat(getComputedStyle(e).animationDuration) * 1000);
  expect(dur).toBeLessThanOrEqual(250);
  await page.screenshot({ path: path.join(screensDir(), "t6_tu_hidden_ui-reveal.png") });
  await page.waitForTimeout(700);
  await expect(revealed).not.toHaveClass(/tu-reveal/);
  await revealed.click();
  await expect(page.getByTestId("tu-tile-1")).toHaveCount(0);
});

test("reduced motion: the revealed tile only fades; 320 px has no sideways scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page);
  await page.getByTestId("tu-tile-2").click();
  const revealed = page.getByTestId("tu-tile-1");
  await expect(revealed).toHaveClass(/tu-reveal/);
  expect(await revealed.evaluate((e) => getComputedStyle(e).animationName)).toBe("tu-fade");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const box = (await revealed.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
});
