// T8 (D131, D132, contract C8): props bar, readable orders. The engine is scripted through the page's test seam
// (globalThis.__tuEngine) so this runs before and after T7 lands.
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
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(screensDir(), `t8_${name}.png`) });

async function setup(page: Page, opts: { withProps?: boolean } = {}) {
  const withProps = opts.withProps ?? true;
  await page.route("**/api/menu", (r) =>
    r.fulfill({ json: { orderingEnabled: true, products: [], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8, ownerWechatId: "bunbunny_bakes" } }),
  );
  await page.route(/\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/, (r) => r.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/game/tu/leaderboard**", (r) =>
    r.fulfill({ json: { week: { start: "2026-10-26T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z" }, top: [], lastWinner: null, allTime: null } }),
  );
  await page.route("**/api/game/tu/start", (r) => r.fulfill({ json: { runId: "r1", seed: "s", tiers: TIERS, expiresAt: "2099-01-01T00:00:00Z" } }));
  await page.addInitScript((wp) => {
    const w = globalThis as unknown as { __tuEngine: unknown; __uses: string[] };
    w.__uses = [];
    // Tile 1 (tier 0) is hidden under tile 2. Tiles 3..10 are free singles (never pack). Tapping 9 completes order 0.
    w.__tuEngine = () => {
      const board = [
        { id: 1, tier: 0, x: 1, y: 1, layer: 0, free: false, visible: false },
        { id: 2, tier: 1, x: 1, y: 1, layer: 1, free: true, visible: true },
        ...[3, 4, 5, 6, 7, 8, 9, 10].map((id, i) => ({ id, tier: 2 + (i % 2), x: (i % 4) * 1.5, y: 2.5 + Math.floor(i / 4) * 1.5, layer: 0, free: true, visible: true })),
      ];
      const bag: number[] = [];
      let orders: [number, number] = [0, 2];
      let bagSize = 6;
      const props = { peek: 1, bag: 1, swap: 1 };
      const state = () => ({
        batch: 1,
        tiles: board.map((t) => ({ ...t })),
        bag: [...bag],
        orders: [...orders],
        score: 0,
        over: false,
        props: { ...props },
        bagSize,
        rewards: [90, 60],
      });
      const g: Record<string, unknown> = {
        over: false,
        score: 0,
        batch: 1,
        taps: 0,
        state,
        tap(id: number) {
          const i = board.findIndex((t) => t.id === id);
          if (i < 0 || !board[i].free) return null;
          const [t] = board.splice(i, 1);
          bag.push(t.tier);
          const ev: unknown[] = [{ type: "move", tile: id, tier: t.tier, slot: bag.length - 1 }];
          if (id === 9) {
            props.swap += 1;
            ev.push({ type: "order", index: 0, tier: 3 }, { type: "gain", p: "swap" });
          }
          return ev;
        },
      };
      if (wp)
        g.use = (p: "peek" | "bag" | "swap") => {
          if (props[p] <= 0 || (p === "bag" && bagSize === 7)) return null;
          props[p] -= 1;
          w.__uses.push(p);
          const ev: unknown[] = [{ type: "prop", p, left: props[p] }];
          if (p === "bag") {
            bagSize = 7;
            ev.push({ type: "bagSize", size: 7 });
          }
          if (p === "swap") {
            orders = [3, 1];
            ev.push({ type: "order", index: 0, tier: 3 }, { type: "order", index: 1, tier: 1 });
          }
          return ev;
        };
      return g;
    };
  }, withProps);
  await page.goto("/game/tu");
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-wechat").fill("bunbunny_fan");
  await page.getByTestId("tu-nickname").fill("小面包");
  await page.getByTestId("tu-start").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
}

test("orders are labelled and show their reward; the props bar shows counts and icons", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tu-orders-label")).toHaveText("订单");
  await expect(page.getByTestId("tu-reward-0")).toHaveText("+90");
  await expect(page.getByTestId("tu-reward-1")).toHaveText("+60");
  for (const k of ["peek", "bag", "swap"]) {
    await expect(page.getByTestId(`tu-prop-count-${k}`)).toHaveText("1");
    const box = (await page.getByTestId(`tu-prop-${k}`).boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId(`tu-prop-${k}`).locator("svg")).toHaveCount(1);
  }
  await shot(page, "props-bar");
  await shot(page, "order-labels");
});

test("no props in the engine: the bar is hidden and the game still works", async ({ page }) => {
  await setup(page, { withProps: false });
  await expect(page.getByTestId("tu-props")).toHaveCount(0);
  await page.getByTestId("tu-tile-3").click();
  await expect(page.getByTestId("tu-slot-0")).toHaveAttribute("data-tier", "2");
});

test("peek shows the hidden tile for 3 s, spends one, and logs nothing broken", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tu-tile-1")).toHaveCount(0);
  await page.getByTestId("tu-prop-peek").click();
  await expect(page.getByTestId("tu-tile-1")).toHaveAttribute("data-hidden", "1");
  await expect(page.getByTestId("tu-tile-1")).toBeDisabled();
  await expect(page.getByTestId("tu-prop-count-peek")).toHaveText("0");
  await expect(page.getByTestId("tu-prop-peek")).toBeDisabled();
  await page.waitForTimeout(400);
  await shot(page, "peek");
  await expect(page.getByTestId("tu-tile-1")).toHaveCount(0, { timeout: 4500 });
  expect(await page.evaluate(() => (globalThis as unknown as { __uses: string[] }).__uses)).toEqual(["peek"]);
});

test("bag prop adds a 7th slot, once; swap changes both orders", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tu-slot-6")).toHaveCount(0);
  await page.getByTestId("tu-prop-bag").click();
  await expect(page.getByTestId("tu-slot-6")).toBeVisible();
  await expect(page.getByTestId("tu-prop-bag")).toBeDisabled();
  await page.waitForTimeout(200);
  for (const id of [3, 4, 5, 6, 7, 8, 10]) {
    await page.getByTestId(`tu-tile-${id}`).click();
    await page.waitForTimeout(200); // the engine ignores taps closer than MIN_TAP_GAP_MS
  }
  await expect(page.getByTestId("tu-slot-6")).toHaveAttribute("data-tier", "3");
  await shot(page, "bag-7-slots");
  await page.waitForTimeout(200);
  await page.getByTestId("tu-prop-swap").click();
  await expect(page.getByTestId("tu-order-0")).toHaveAttribute("data-tier", "3");
  await expect(page.getByTestId("tu-order-1")).toHaveAttribute("data-tier", "1");
  await expect(page.getByTestId("tu-prop-swap")).toBeDisabled();
});

test("completing an order shows its reward and the gained prop", async ({ page }) => {
  await setup(page);
  await page.getByTestId("tu-tile-9").click();
  const toast = page.getByTestId("tu-toast");
  await expect(toast).toContainText("订单完成 +90");
  await expect(toast).toContainText("得到 换订单");
  await expect(page.getByTestId("tu-prop-count-swap")).toHaveText("2");
  await shot(page, "order-reward");
});

test("the order cards pulse once on the very first game only", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("tu-order-0")).toHaveClass(/tu-order-pulse/);
  await page.waitForTimeout(1800);
  await expect(page.getByTestId("tu-order-0")).not.toHaveClass(/tu-order-pulse/);
  await page.reload();
  await page.getByTestId("tu-menu-start").click();
  await page.getByTestId("tu-start").click();
  await expect(page.getByTestId("tu-board")).toBeVisible();
  await expect(page.getByTestId("tu-order-0")).not.toHaveClass(/tu-order-pulse/);
});

test("320 px: no sideways scroll with the props bar and a 7-slot bag", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page);
  await page.getByTestId("tu-prop-bag").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  for (const k of ["peek", "bag", "swap"]) {
    const box = (await page.getByTestId(`tu-prop-${k}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
