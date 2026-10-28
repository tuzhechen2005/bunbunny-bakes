// The paper bag (bar, pile physics, flights, bag sheet) on the real home page, with /api/menu
// mocked as the other home specs do. Photos are mocked with a fixture image.
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, expect, test, type Page } from "@playwright/test";
import { addFromTile, openTile } from "./support/addFromTile";

const CART_KEY = "bb_cart_v1";
const PHOTO = fs.readFileSync(path.join(__dirname, "../fixtures/bun.jpg"));

const BASE_PRODUCTS = [
  ["hd", "奶酥红豆包", 249, 899, 1],
  ["rs", "岩烧乳酪包", 249, 899, 1],
  ["nj", "奶酪角", 299, 1099, 1],
  ["bl", "焦糖布蕾", 249, 899, 2],
] as const;

interface MenuOpts {
  closed?: boolean;
  noPhoto?: boolean;
  max?: number;
  /** Hold /api/menu back until this promise resolves (the menu arrives after the cart). */
  gate?: Promise<void>;
}

async function mockMenu(page: Page, o: MenuOpts = {}) {
  const products = BASE_PRODUCTS.map(([id, name, unit, bundle, lead]) => ({
    id,
    name,
    description: null,
    imageUrl: o.noPhoto ? null : `/test-photos/${id}.jpg`,
    unitPriceCents: unit,
    bundleSize: 4,
    bundlePriceCents: bundle,
    status: "ACTIVE",
    leadDays: lead,
  }));
  await page.route("**/api/menu", async (route) => {
    await o.gate;
    await route.fulfill({
      json: {
        orderingEnabled: !o.closed,
        products,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: o.max ?? 20,
      },
    });
  });
  await page.route("**/test-photos/*.jpg", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
}

const barPile = (page: Page) => page.locator('[data-bag-target="bar"] .pb-pi');
const sheetPile = (page: Page) => page.locator('[data-bag-target="sheet"] .pb-pi');

async function openHome(page: Page, o: MenuOpts = {}) {
  await mockMenu(page, o);
  await page.goto("/");
  await expect(page.getByTestId("bag-bar")).toBeVisible();
  if (!o.gate) await expect(page.getByTestId("rack")).toBeVisible();
}

/** Puts `n` of a product in the bag from the detail of its list tile (one flight carrying `n`, D97). */
const add = addFromTile;

/** Puts `qty` of the product at rope position `index` in the bag in ONE flight, from its detail view. */
async function addViaDetail(page: Page, index: number, qty: number) {
  await page.getByTestId("rack").focus();
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("detail")).toBeVisible({ timeout: 3000 });
  for (let i = 1; i < qty; i++) await page.getByTestId("detail-inc").click();
  await page.getByTestId("detail-add").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
}

async function pileCount(page: Page, which: "bar" | "sheet" = "bar") {
  return (which === "bar" ? barPile(page) : sheetPile(page)).count();
}

test("empty bag: no badge, $0.00, the bag opens and says it is empty", async ({ page }) => {
  await openHome(page);
  await expect(page.getByTestId("bag-subtotal")).toHaveText("$0.00");
  await expect(page.getByTestId("bag-badge")).toHaveText("0");
  await expect(page.getByTestId("bag-badge")).toHaveClass(/scale-0/);
  await expect(page.getByTestId("bag-count")).toHaveText("已选 0 件"); // the spoken count
  expect(await pileCount(page)).toBe(0);
  await page.getByTestId("bag-pill").click();
  await expect(page.getByRole("dialog", { name: "你的纸袋" })).toBeVisible();
  await expect(page.getByTestId("bag-empty")).toBeVisible();
  await expect(page.getByTestId("bag-checkout")).toBeDisabled();
});

test("an add flies: the amount updates at once, the badge counts the bread on landing, never twice", async ({
  page,
}) => {
  await openHome(page);
  await openTile(page, "rs");
  // In one synchronous step: click, then read the page. The bread must be in the air, not yet in
  // the bag: the amount is already right, the badge counts only what has landed.
  const atClick = await page.evaluate(async () => {
    const click = document.querySelector<HTMLElement>('[data-testid="detail-add"]')!;
    click.click();
    await new Promise((r) => setTimeout(r, 120)); // staggered start of the first disc
    return {
      discs: document.querySelectorAll(".bag-fly").length,
      pile: document.querySelectorAll('[data-bag-target="bar"] .pb-pi').length,
      count: document.querySelector('[data-testid="bag-badge"]')!.textContent,
      subtotal: document.querySelector('[data-testid="bag-subtotal"]')!.textContent,
    };
  });
  expect(atClick).toEqual({ discs: 1, pile: 0, count: "0", subtotal: "$2.49" });
  await expect(page.getByTestId("bag-count")).toHaveText("已选 1 件"); // the spoken count is not delayed
  // It lands inside the window about 0.62 s after take-off, and the badge follows.
  await expect.poll(() => pileCount(page), { timeout: 3000 }).toBe(1);
  await expect(page.getByTestId("bag-badge")).toHaveText("1");
  await expect(page.locator(".bag-fly")).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(await pileCount(page)).toBe(1); // not counted twice
  await expect(page.getByTestId("bag-live")).toHaveText("已放进纸袋：岩烧乳酪包 ×1");
});

test("adding several at once flies several discs and the pile matches the cart", async ({ page }) => {
  await openHome(page);
  await addViaDetail(page, 0, 3); // one flight carrying three breads
  await expect(page.getByTestId("bag-badge")).toHaveText("3");
  await expect(page.getByTestId("bag-count")).toHaveText("已选 3 件");
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(3);
  await add(page, "bl");
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(4);
  await page.waitForTimeout(1000);
  expect(await pileCount(page)).toBe(4);
  await expect(page.getByTestId("bag-subtotal")).toHaveText("$9.96"); // 3 x 2.49 + 2.49
});

test("the pile is capped at 24 bodies while the count keeps going", async ({ page }) => {
  await openHome(page);
  await add(page, "nj", 20);
  await expect(page.getByTestId("bag-badge")).toHaveText("20"); // max per item 20
  await expect.poll(() => pileCount(page), { timeout: 8000 }).toBe(20);
  await add(page, "hd", 9);
  await expect(page.getByTestId("bag-badge")).toHaveText("29");
  await expect.poll(() => pileCount(page), { timeout: 8000 }).toBe(24);
  await page.waitForTimeout(800);
  expect(await pileCount(page)).toBe(24);
});

test("the frame loop sleeps when everything rests", async ({ page }) => {
  // The 小小🐰 orb is the one allowed continuous animation (D119); keep it still here.
  await page.addInitScript(() => {
    (window as unknown as { __noOrbMotion: boolean }).__noOrbMotion = true;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf++;
      return raf(cb);
    };
  });
  await openHome(page);
  await add(page, "hd", 3);
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(3);
  const frames = () => page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await expect.poll(async () => {
    const a = await frames();
    await page.waitForTimeout(400);
    return (await frames()) - a;
  }, { timeout: 8000 }).toBe(0); // bread settled, bag swing done: not one frame requested
});

test("discs get their photo when the menu arrives after the cart; a cart line off the menu adds no disc", async ({
  page,
}) => {
  await page.addInitScript(
    ([key]) =>
      localStorage.setItem(
        key,
        JSON.stringify([
          { productId: "hd", qty: 2 },
          { productId: "gone", qty: 3 },
        ]),
      ),
    [CART_KEY],
  );
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await openHome(page, { gate });
  await expect(page.getByTestId("bag-badge")).toHaveText("0"); // no menu yet: nothing to show
  expect(await pileCount(page)).toBe(0);
  release(); // the menu arrives with photo URLs
  await expect(page.getByTestId("bag-badge")).toHaveText("2");
  await expect.poll(() => pileCount(page)).toBe(2); // "gone" is not on the menu: no discs for it
  await expect(page.locator('[data-bag-target="bar"] .pb-pi.pb-ph')).toHaveCount(0); // they got their photo
  const bg = await barPile(page).first().evaluate((e) => (e as HTMLElement).style.backgroundImage);
  expect(bg).toContain("/test-photos/hd.jpg");
  expect(await pileCount(page)).toBe(2);
});

test("the pile starts settled from the saved cart", async ({ page }) => {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, JSON.stringify([{ productId: "hd", qty: 4 }, { productId: "bl", qty: 2 }])),
    [CART_KEY],
  );
  await openHome(page);
  await expect(page.getByTestId("bag-badge")).toHaveText("6");
  await expect.poll(() => pileCount(page)).toBe(6);
  // Settled: nothing moves between two frames.
  const snap = () => barPile(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform).join("|"));
  const a = await snap();
  await page.waitForTimeout(300);
  expect(await snap()).toBe(a);
  await expect(page.getByTestId("bag-subtotal")).toHaveText("$13.97"); // 4 for $8.99 + 2 x 2.49
});

test("bag sheet: opens from the pill and from the little bag, shows lines, closes with Esc, backdrop and the button", async ({
  page,
}) => {
  await openHome(page);
  await add(page, "rs", 3);
  await add(page, "bl");
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(4);

  const dialog = page.getByRole("dialog", { name: "你的纸袋" });
  await page.getByTestId("bag-pill").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("bag-close")).toBeFocused();
  await expect(page.getByTestId("bag-line")).toHaveCount(2);
  await expect(page.getByTestId("bag-sheet-subtotal")).toHaveText("$9.96");
  await expect.poll(() => pileCount(page, "sheet")).toBe(4); // the big bag starts with the same bread
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: /打开你的纸袋/ }).click();
  await expect(dialog).toBeVisible();
  await page.getByTestId("bag-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);

  await page.getByTestId("bag-pill").click();
  await page.getByTestId("bag-close").click();
  await expect(dialog).toHaveCount(0);
  // Focus goes back to what opened it.
  await expect(page.getByTestId("bag-pill")).toBeFocused();
});

test("bag sheet: − n + changes the cart, the pile follows, a bread pops out at zero", async ({ page }) => {
  await openHome(page);
  await add(page, "hd", 3);
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(3);
  await page.getByTestId("bag-pill").click();
  const line = page.getByTestId("bag-line").first();
  await expect(line.getByTestId("bag-line-qty")).toHaveText("3");

  await line.getByTestId("bag-line-inc").click();
  await expect(line.getByTestId("bag-line-qty")).toHaveText("4");
  await expect(page.getByTestId("bag-sheet-subtotal")).toHaveText("$8.99"); // 4 for the bundle price
  await expect.poll(() => pileCount(page, "sheet")).toBe(4);
  await expect.poll(() => pileCount(page, "bar")).toBe(4); // the little bag behind keeps up

  await line.getByTestId("bag-line-dec").click();
  await line.getByTestId("bag-line-dec").click();
  await expect(line.getByTestId("bag-line-qty")).toHaveText("2");
  await expect.poll(() => pileCount(page, "sheet"), { timeout: 3000 }).toBe(2);
  await line.getByTestId("bag-line-dec").click();
  await line.getByTestId("bag-line-dec").click();
  await expect(page.getByTestId("bag-empty")).toBeVisible();
  await expect.poll(() => pileCount(page, "sheet"), { timeout: 3000 }).toBe(0);
  await expect(page.getByTestId("bag-checkout")).toBeDisabled();
  await expect(page.getByTestId("bag-badge")).toHaveText("0");
});

test("bag sheet: max per item disables + and shows the hint", async ({ page }) => {
  await openHome(page, { max: 3 });
  await add(page, "hd", 3);
  await page.getByTestId("bag-pill").click();
  const line = page.getByTestId("bag-line").first();
  await expect(line.getByTestId("bag-line-inc")).toBeDisabled();
  await expect(line).toContainText("大量订购请加微信联系");
  await line.getByTestId("bag-line-dec").click();
  await expect(line.getByTestId("bag-line-inc")).toBeEnabled();
});

test("去结算 zooms the arrow and calls onCheckout; it is disabled when ordering is closed", async ({ page }) => {
  await openHome(page);
  await add(page, "hd");
  await page.getByTestId("bag-pill").click();
  const go = page.getByTestId("bag-checkout");
  await expect(go).toBeEnabled();
  await expect(go).toContainText("去结算");
  await go.click();
  await expect(page).toHaveURL(/\/checkout$/);

  await openHome(page, { closed: true });
  await add(page, "hd");
  await page.getByTestId("bag-pill").click(); // the bag still opens
  await expect(page.getByTestId("bag-checkout")).toBeDisabled();
  await page.evaluate(async () => {
    const panel = document.querySelector('[data-testid="bag-sheet"]')!;
    await Promise.all(panel.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  await expect(page.getByTestId("bag-checkout")).toContainText("暂未开放预订");
  await page.getByTestId("bag-checkout").click({ force: true });
  await expect(page).toHaveURL(/\/$/);
});

test("compact (detail open): the pill hides, the little bag stays and still opens the sheet", async ({ page }) => {
  await openHome(page);
  await page.getByTestId("rack").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("detail")).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId("bag-pill")).toHaveCSS("opacity", "0");
  await page.getByTestId("detail-add").click();
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(1); // flights still land
  await page.getByRole("button", { name: /打开你的纸袋/ }).click();
  await expect(page.getByRole("dialog", { name: "你的纸袋" })).toBeVisible();
});

test("products without a photo drop in as plain discs", async ({ page }) => {
  await openHome(page, { noPhoto: true });
  await add(page, "hd", 3);
  await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(3);
  await expect(page.locator('[data-bag-target="bar"] .pb-pi.pb-ph')).toHaveCount(3);
});

test("reduced motion: no flight, the bread is in the bag at once, the sheet fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  await addViaDetail(page, 0, 3);
  await expect(page.locator(".bag-fly")).toHaveCount(0);
  await expect.poll(() => pileCount(page), { timeout: 1000 }).toBe(3);
  await expect(page.getByTestId("bag-live")).toHaveText("已放进纸袋：奶酥红豆包 ×3");
  await page.getByTestId("bag-pill").click();
  await expect(page.getByRole("dialog", { name: "你的纸袋" })).toBeVisible();
  const line = page.getByTestId("bag-line").first();
  await line.getByTestId("bag-line-inc").click();
  await expect.poll(() => pileCount(page, "sheet")).toBe(4);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "你的纸袋" })).toHaveCount(0);
});

test("shaking the big bag with the mouse moves the bag and rolls the bread", async ({ page }) => {
  await openHome(page);
  await add(page, "hd", 3);
  await expect.poll(() => pileCount(page), { timeout: 8000 }).toBe(3);
  await page.getByTestId("bag-pill").click();
  await expect.poll(() => pileCount(page, "sheet")).toBe(3);
  // Deterministic start: the sheet's opening animations are over and the pile has come to rest
  // (two identical snapshots 300 ms apart), however slow the machine is.
  await page.evaluate(async () => {
    const panel = document.querySelector('[data-testid="bag-sheet"]')!;
    await Promise.all(panel.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)));
  });
  const snap = () => sheetPile(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform).join("|"));
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await snap();
        const same = now === last;
        last = now;
        await page.waitForTimeout(300);
        return same;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const bag = page.locator('[data-bag-target="sheet"] .pb');
  const sw = bag.locator(".pb-sw");
  await expect.poll(() => sw.evaluate((e) => (e as HTMLElement).style.transform), { timeout: 10000 }).toBe("");
  const box = (await bag.boundingBox())!;
  const before = await snap();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(box.x + box.width / 2 + (i % 2 ? -50 : 50), box.y + box.height / 2, { steps: 6 });
  }
  expect(await sw.evaluate((e) => (e as HTMLElement).style.transform)).toContain("translate(");
  // The bread rolls around while (or shortly after) the bag is shaken.
  await expect.poll(snap, { timeout: 8000 }).not.toBe(before);
  await page.mouse.up();
  // It springs back and everything rests again.
  await expect.poll(() => sw.evaluate((e) => (e as HTMLElement).style.transform), { timeout: 10000 }).toBe("");
});

// Real touch events through the Chrome DevTools protocol (WebKit has no equivalent): a finger on
// the big bag shakes it in any direction and the page must not scroll or pull along.
test("touch drag on the big bag shakes it, the page stays put, it springs back", async ({ baseURL }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 13"];
  void _ignored;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...phone, hasTouch: true, baseURL });
  try {
    await context.route("**/test-photos/*.jpg", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
    const page = await context.newPage();
    await openHome(page);
    await add(page, "hd", 3);
    await expect.poll(() => pileCount(page), { timeout: 4000 }).toBe(3);
    await page.getByTestId("bag-pill").click();
    await expect.poll(() => pileCount(page, "sheet")).toBe(3);
    await page.waitForTimeout(1500); // the opening hop settles
    const bag = page.locator('[data-bag-target="sheet"] .pb');
    const box = (await bag.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const snap = () => sheetPile(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform).join("|"));
    const before = await snap();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await touch("touchStart", cx, cy);
    // Mostly vertical first (the page would scroll if the touch were not ours), then side to side.
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", cx + 4 * i, cy + 12 * i);
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 10; i++) {
      await touch("touchMove", cx + (i % 2 ? -45 : 45), cy);
      await page.waitForTimeout(16);
    }
    const sw = bag.locator(".pb-sw");
    expect(await sw.evaluate((e) => (e as HTMLElement).style.transform)).toContain("translate(");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await touch("touchEnd", cx, cy);
    expect(await snap()).not.toBe(before); // the bread rolled around
    await expect.poll(() => sw.evaluate((e) => (e as HTMLElement).style.transform), { timeout: 6000 }).toBe("");
  } finally {
    await browser.close();
  }
});

// Safari does not Tab to buttons by default, so the focus trap is checked in Chrome.
test("the sheet keeps Tab and Shift+Tab inside the dialog", async ({ baseURL }) => {
  const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 13"];
  void _ignored;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...phone, baseURL });
  try {
    await context.route("**/test-photos/*.jpg", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
    const page = await context.newPage();
    await openHome(page);
    await add(page, "hd", 3);
    await add(page, "bl");
    await page.getByTestId("bag-pill").click();
    const dialog = page.getByRole("dialog", { name: "你的纸袋" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("bag-close")).toBeFocused();
    const inside = () => dialog.evaluate((d) => d.contains(document.activeElement));
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test("the sheet fits a 320 px screen with 44 px touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openHome(page);
  await add(page, "hd", 3);
  await add(page, "bl");
  await page.getByTestId("bag-pill").click();
  await expect(page.getByRole("dialog", { name: "你的纸袋" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Touch targets are at least 44 px.
  for (const id of ["bag-line-inc", "bag-line-dec", "bag-close"]) {
    const box = (await page.getByTestId(id).first().boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
});
