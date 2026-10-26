// J3: the continuous bag -> checkout -> order flow, the control kit (Stepper, Sheet, TopBar) and
// Back-button handling. /api/menu and the other customer APIs are mocked like the other specs.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addFromTile } from "./support/addFromTile";

const CART_KEY = "bb_cart_v1";
const PHOTO = fs.readFileSync(path.join(__dirname, "../fixtures/bun.jpg"));

const PRODUCTS = [
  ["hd", "奶酥红豆包", 249, 899, 1],
  ["rs", "岩烧乳酪包", 249, 899, 1],
  ["nj", "奶酪角", 299, 1099, 1],
  ["bl", "焦糖布蕾", 249, 899, 2],
] as const;

async function mockMenu(page: Page, o: { closed?: boolean } = {}) {
  const products = PRODUCTS.map(([id, name, unit, bundle, lead]) => ({
    id,
    name,
    description: null,
    imageUrl: `/test-photos/${id}.jpg`,
    unitPriceCents: unit,
    bundleSize: 4,
    bundlePriceCents: bundle,
    status: "ACTIVE",
    leadDays: lead,
  }));
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled: !o.closed,
        products,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 20,
      },
    }),
  );
  await page.route("**/test-photos/*.jpg", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
}

async function openHome(page: Page) {
  await mockMenu(page);
  await page.goto("/");
  await expect(page.getByTestId("bag-bar")).toBeVisible();
  await expect(page.getByTestId("rack")).toBeVisible();
}

/** Puts `n` of a product in the bag from its detail (D97). */
const add = addFromTile;

/** Waits until the sheet's opening animations are done (the spring owns `transform` until then). */
const sheetSettled = (page: Page) =>
  page.evaluate(async () => {
    const panel = document.querySelector('[data-testid="bag-sheet"]')!;
    await Promise.all(panel.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "你的纸袋" });

test.describe("bag sheet", () => {
  test("the pill opens the sheet after about 120 ms, without waiting for the arrow zoom", async ({ page }) => {
    await openHome(page);
    await add(page, "hd");
    await expect(page.getByTestId("bag-badge")).toHaveText("1");
    const opened = await page.evaluate(async () => {
      const t0 = performance.now();
      document.querySelector<HTMLElement>('[data-testid="bag-pill"]')!.click();
      while (!document.querySelector('[data-testid="bag-sheet"]')) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    });
    expect(opened).toBeGreaterThan(80);
    expect(opened).toBeLessThan(300); // the arrow zoom alone takes ~0.6 s
    await expect(dialogOf(page)).toBeVisible();
  });

  test("the badge pops 1 -> 1.22 -> 1 when more bread lands", async ({ page }) => {
    await openHome(page);
    await add(page, "hd");
    await expect(page.getByTestId("bag-badge")).toHaveText("1");
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const badge = document.querySelector<HTMLElement>('[data-testid="bag-badge"]')!;
      const w = window as unknown as { __scales: number[] };
      w.__scales = [];
      const tick = () => {
        const m = getComputedStyle(badge).transform;
        if (m.startsWith("matrix(")) w.__scales.push(Number(m.slice(7).split(",")[0]));
        requestAnimationFrame(tick);
      };
      tick();
    });
    await add(page, "rs");
    await expect(page.getByTestId("bag-badge")).toHaveText("2");
    await page.waitForTimeout(500);
    const scales = await page.evaluate(() => (window as unknown as { __scales: number[] }).__scales);
    expect(Math.max(...scales)).toBeGreaterThan(1.15);
    expect(Math.max(...scales)).toBeLessThan(1.3);
    expect(scales[scales.length - 1]).toBeCloseTo(1, 2);
  });

  test("the +/- buttons and the count name the bread", async ({ page }) => {
    await openHome(page);
    await add(page, "rs", 2);
    await page.getByTestId("bag-pill").click();
    const line = page.getByTestId("bag-line").first();
    await expect(line.getByRole("button", { name: "增加一个 岩烧乳酪包" })).toBeVisible();
    await expect(line.getByRole("button", { name: "减少一个 岩烧乳酪包" })).toBeVisible();
    await expect(line.getByTestId("bag-line-qty")).toHaveAttribute("aria-label", "岩烧乳酪包 已选 2 个");
  });

  test("去结算: the sheet grows to the full screen, then the checkout page opens", async ({ page }) => {
    await openHome(page);
    await add(page, "hd");
    await page.getByTestId("bag-pill").click();
    await expect(page.getByTestId("bag-checkout")).toBeEnabled();
    await page.waitForTimeout(900); // the opening spring settles
    await page.evaluate(() => {
      const w = window as unknown as { __maxPanel: number };
      w.__maxPanel = 0;
      const tick = () => {
        const p = document.querySelector('[data-testid="bag-sheet"]');
        if (p) w.__maxPanel = Math.max(w.__maxPanel, p.getBoundingClientRect().height);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.getByTestId("bag-checkout").click();
    await expect(page).toHaveURL(/\/checkout$/);
    const grown = await page.evaluate(() => ({
      max: (window as unknown as { __maxPanel: number }).__maxPanel,
      h: window.innerHeight,
    }));
    expect(grown.max).toBeGreaterThanOrEqual(grown.h - 2);
  });

  test("browser Back closes the sheet first and stays on the page; closing by button leaves no spare entry", async ({
    page,
  }) => {
    await openHome(page);
    const depth = () => page.evaluate(() => history.length);
    // Measured before the add: the detail the bread comes from pushes and steps back its own entry.
    const before = await depth();
    await add(page, "hd");
    await expect
      .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.bbOverlay ?? null))
      .toBeNull();
    await page.getByTestId("bag-pill").click();
    await expect(dialogOf(page)).toBeVisible();
    await expect.poll(depth).toBe(before + 1); // one entry for the sheet
    await page.goBack();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/); // still on the home page
    await expect(page.getByTestId("bag-bar")).toBeVisible();
    await expect(page.getByTestId("bag-pill")).toBeFocused();

    // Closing by the button (or Esc) takes its entry away again: Back would now leave the page.
    await page.getByTestId("bag-pill").click();
    await expect(dialogOf(page)).toBeVisible();
    await page.getByTestId("bag-close").click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.bbOverlay ?? null))
      .toBeNull();
    await page.getByTestId("bag-pill").click();
    await expect(dialogOf(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.bbOverlay ?? null))
      .toBeNull();
  });

  test("Back from the checkout page lands on the home page: no sheet, no spare entry", async ({ page }) => {
    await openHome(page);
    await add(page, "hd");
    await page.getByTestId("bag-pill").click();
    await page.getByTestId("bag-checkout").click();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("bag-bar")).toBeVisible();
    await page.goBack(); // the next Back leaves the app (the blank page the test started on)
    await expect(page).not.toHaveURL(/localhost/);
  });

  test("pulling the sheet down more than 110 px dismisses it; a short pull springs back", async ({ page }) => {
    await openHome(page);
    await add(page, "hd");
    await page.getByTestId("bag-pill").click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await sheetSettled(page);
    const top = (await dialog.boundingBox())!.y;
    const title = dialog.getByRole("heading");
    const box = (await title.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x, y + i * 10); // slow: well under 0.5 px/ms
      await page.waitForTimeout(50);
    }
    expect((await dialog.boundingBox())!.y).toBeGreaterThan(top + 40); // it follows the finger
    await page.waitForTimeout(150); // a pause before lifting is not a fling
    await page.mouse.up();
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.y)).toBe(Math.round(top));

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 90, { steps: 4 });
    await page.mouse.move(x, y + 160, { steps: 4 });
    await page.mouse.up();
    await expect(dialog).toHaveCount(0);
  });

  test("a product that left the menu is taken out of the bag with a one-time notice", async ({ page }) => {
    await page.addInitScript(
      ([key]) =>
        localStorage.setItem(
          key,
          JSON.stringify([
            { productId: "hd", qty: 1 },
            { productId: "gone", qty: 2 },
          ]),
        ),
      [CART_KEY],
    );
    await openHome(page);
    await expect(page.getByTestId("bag-badge")).toHaveText("1");
    await page.getByTestId("bag-pill").click();
    await expect(page.getByTestId("bag-notice")).toHaveText("有商品已下架，已从纸袋移除");
    await page.getByTestId("bag-close").click();
    await expect(dialogOf(page)).toHaveCount(0);
    await page.getByTestId("bag-pill").click();
    await expect(page.getByTestId("bag-lines")).toBeVisible();
    await expect(page.getByTestId("bag-notice")).toHaveCount(0);
  });

  test("the cart follows another tab (storage event)", async ({ page, context }) => {
    await openHome(page);
    await expect(page.getByTestId("bag-badge")).toHaveText("0");
    const other = await context.newPage();
    await mockMenu(other);
    await other.goto("/");
    await expect(other.getByTestId("rack")).toBeVisible();
    await add(other, "nj", 2);
    await expect(page.getByTestId("bag-subtotal")).toHaveText("$5.98");
    await expect(page.getByTestId("bag-badge")).toHaveText("2");
    await other.close();
  });

  test("reduced motion: the sheet opens at once and 去结算 does not wait for any animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await add(page, "hd");
    await page.getByTestId("bag-pill").click();
    await expect(dialogOf(page)).toBeVisible({ timeout: 600 });
    await page.getByTestId("bag-checkout").click();
    await expect(page).toHaveURL(/\/checkout$/);
  });
});
