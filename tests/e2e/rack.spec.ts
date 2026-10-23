// The rope rack and its "take down" detail, against a mocked /api/menu, on the dev harness page.
import { expect, test, type Page } from "@playwright/test";

const CART_KEY = "bb_cart_v1";

const PRODUCTS = [
  { id: "p-redbean", name: "奶酥红豆包", description: "奶酥的香脆，红豆的绵软。", imageUrl: "/api/images/redbean.svg", unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p-cheese", name: "奶酪角", description: "厚涂奶油奶酪酱。", imageUrl: null, unitPriceCents: 299, bundleSize: 4, bundlePriceCents: 1099, status: "ACTIVE", leadDays: 1 },
  { id: "p-brulee", name: "焦糖布蕾", description: "咔吱一下。", imageUrl: null, unitPriceCents: 450, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 2 },
  { id: "p-paused", name: "菠萝包", description: "暂停中", imageUrl: null, unitPriceCents: 300, bundleSize: 1, bundlePriceCents: null, status: "PAUSED", leadDays: 1 },
];

async function mockMenu(page: Page) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled: true,
        products: PRODUCTS,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 3,
      },
    }),
  );
  await page.route("**/api/images/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#b5652a"/></svg>',
    }),
  );
}

async function open(page: Page) {
  await mockMenu(page);
  await page.goto("/dev-rack");
  await expect(page.getByTestId("rack-item")).toHaveCount(PRODUCTS.length);
}

const selected = (page: Page) => page.locator('[data-testid="rack-item"][data-selected="true"]');
const itemId = (page: Page, id: string) => page.locator(`[data-testid="rack-item"][data-product-id="${id}"]`);

/** Pointer drag on the stage with intermediate moves (a real swipe has many events). */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy = 0, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(8);
  }
  await page.waitForTimeout(120); // a pause before release: settle on the nearest card, no fling
  await page.mouse.up();
}

async function centreOf(page: Page, id: string) {
  const box = await itemId(page, id).getByTestId("rack-card").boundingBox();
  if (!box) throw new Error("card not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("rack: centre card first, side cards behind, paused greyed, bunny on paper", async ({ page }) => {
  await open(page);
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-redbean");
  await expect(page.getByTestId("rack-current")).toHaveText("$2.49 / 个　4 个 $8.99");
  // product without a photo shows the bunny mark
  await expect(itemId(page, "p-cheese").getByTestId("rack-photo-empty")).toHaveCount(1);
  await expect(itemId(page, "p-redbean").locator("img")).toHaveCount(1);
  // the centre card is larger than its neighbour and the neighbour is turned
  const [a, b] = await Promise.all([
    itemId(page, "p-redbean").getByTestId("rack-card").boundingBox(),
    itemId(page, "p-cheese").getByTestId("rack-card").boundingBox(),
  ]);
  expect(a!.height).toBeGreaterThan(b!.height);
  const tf = await itemId(page, "p-cheese").evaluate((el) => (el as HTMLElement).style.transform);
  expect(tf).toMatch(/rotateY\(-?\d/);
  expect(tf).not.toContain("rotateY(0deg)");
  await expect(itemId(page, "p-paused")).toHaveAttribute("data-paused", "true");
  await expect(itemId(page, "p-paused")).toContainText("暂停供应");
  // title is the shiny 今日出炉
  await expect(page.getByRole("heading", { name: "今日出炉" })).toBeVisible();
});

test("rack: dragging the rope moves the selection and the loop goes back to sleep", async ({ page }) => {
  await open(page);
  const start = await centreOf(page, "p-redbean");
  await drag(page, start, -170);
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-cheese");
  await expect(page.getByTestId("rack-current")).toHaveText("$2.99 / 个　4 个 $10.99");
  // dragging right goes back
  await drag(page, await centreOf(page, "p-cheese"), 170);
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-redbean");
  // after about a second the pegs are still: no inline rotation left on any swing wrapper
  await page.waitForTimeout(1600);
  const swinging = await page.locator('[data-testid="rack-item"] > div').evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).style.transform !== "").length,
  );
  expect(swinging).toBe(0);
});

test("rack: tapping a side card slides it to the centre; the rope does not run past the ends", async ({ page }) => {
  await open(page);
  await itemId(page, "p-cheese").getByTestId("rack-card").click();
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-cheese");
  await expect(page.getByTestId("rack-detail")).toHaveCount(0);
  // dragging right on the first card only rubber-bands
  await itemId(page, "p-cheese").getByTestId("rack-card").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await drag(page, await centreOf(page, "p-cheese"), 400, 0, 20);
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-redbean");
});

test("rack: tap the centre card, add from the detail, bag count updates", async ({ page }) => {
  await open(page);
  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  const dialog = page.getByRole("dialog", { name: "奶酥红豆包" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("rack-detail-price")).toHaveText("$2.49 / 个　4 个 $8.99");
  await expect(dialog).toContainText("奶酥的香脆，红豆的绵软。");
  await expect(dialog.getByTestId("rack-position")).toHaveText("1 / 4");
  await dialog.getByRole("button", { name: "增加一个" }).click();
  await expect(dialog.getByTestId("rack-detail-qty")).toHaveText("2");
  await dialog.getByTestId("rack-add").click();
  await expect(page.getByTestId("bar-count")).toHaveText("2");
  await expect(dialog.getByTestId("rack-in-bag")).toHaveText("纸袋里已有 2 个");
  // the per-item maximum (3 in this menu) caps what can be added
  await dialog.getByTestId("rack-add").click();
  await expect(page.getByTestId("bar-count")).toHaveText("3");
  await expect(dialog.getByTestId("rack-add")).toBeDisabled();
  await expect(dialog.getByTestId("rack-max-hint")).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), CART_KEY)).toBe(JSON.stringify([{ productId: "p-redbean", qty: 3 }]));
});

test("rack: 挂回去 and Esc close the detail, the card is back on the rope", async ({ page }) => {
  await open(page);
  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  await expect(page.getByTestId("rack-detail")).toBeVisible();
  await page.getByRole("button", { name: /挂回去/ }).click();
  await expect(page.getByTestId("rack-detail")).toHaveCount(0);
  await expect(itemId(page, "p-redbean").getByTestId("rack-card")).toBeVisible();
  await expect(itemId(page, "p-redbean").getByTestId("rack-card")).toBeFocused();

  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  await expect(page.getByTestId("rack-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rack-detail")).toHaveCount(0);
});

test("rack: pulling the photo down more than 90px hangs it back; a short pull does not", async ({ page }) => {
  await open(page);
  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  const photo = page.getByTestId("rack-detail-photo");
  await expect(photo).toBeVisible();
  await page.waitForTimeout(600); // opening flight finished
  const box = (await photo.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(page, from, 0, 50);
  await expect(page.getByTestId("rack-detail")).toBeVisible();
  await page.waitForTimeout(400);
  const box2 = (await photo.boundingBox())!;
  await drag(page, { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 }, 0, 150);
  await expect(page.getByTestId("rack-detail")).toHaveCount(0);
});

test("rack: previous / next inside the detail, and the rack follows", async ({ page }) => {
  await open(page);
  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  const dialog = page.getByTestId("rack-detail");
  await expect(dialog.getByTestId("rack-prev")).toBeDisabled();
  await dialog.getByTestId("rack-next").click();
  await expect(dialog.getByTestId("rack-detail-name")).toHaveText("奶酪角");
  await expect(dialog.getByTestId("rack-position")).toHaveText("2 / 4");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByTestId("rack-detail-name")).toHaveText("菠萝包");
  await expect(dialog.getByTestId("rack-next")).toBeDisabled();
  await dialog.getByTestId("rack-close").click();
  await expect(page.getByTestId("rack-detail")).toHaveCount(0);
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-paused");
});

test("rack: a paused product can be looked at but not added", async ({ page }) => {
  await open(page);
  await itemId(page, "p-paused").getByTestId("rack-card").click(); // to centre
  await itemId(page, "p-paused").getByTestId("rack-card").click(); // open
  const dialog = page.getByTestId("rack-detail");
  await expect(dialog.getByTestId("rack-add")).toBeDisabled();
  await expect(dialog.getByTestId("rack-add")).toHaveText("暂停供应");
  await expect(page.getByTestId("bar-count")).toHaveText("0");
});

test("rack: keyboard moves with arrows, Enter opens, only the centre card is in the tab order", async ({ page }) => {
  await open(page);
  const first = itemId(page, "p-redbean").getByTestId("rack-card");
  await first.focus();
  await expect(itemId(page, "p-cheese").getByTestId("rack-card")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-cheese");
  await expect(itemId(page, "p-cheese").getByTestId("rack-card")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-redbean");
  await page.keyboard.press("End");
  await expect(selected(page)).toHaveAttribute("data-product-id", "p-paused");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("rack-detail")).toBeVisible();
  await expect(page.getByTestId("rack-close")).toBeFocused();
});

test("rack: no horizontal scroll at 320px and touch targets are 44px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await itemId(page, "p-redbean").getByTestId("rack-card").click();
  const dialog = page.getByTestId("rack-detail");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const id of ["rack-close", "rack-add", "rack-prev", "rack-next"]) {
    const box = (await dialog.getByTestId(id).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no tilt or swing; swipe, open, add and close still work", async ({ page }) => {
    await open(page);
    const tf = await itemId(page, "p-cheese").evaluate((el) => (el as HTMLElement).style.transform);
    expect(tf).toContain("rotateY(0deg)");
    await drag(page, await centreOf(page, "p-redbean"), -120);
    await expect(selected(page)).toHaveAttribute("data-product-id", "p-cheese");
    const inner = await itemId(page, "p-cheese").locator("> div").evaluate((el) => (el as HTMLElement).style.transform);
    expect(inner).toBe("");
    await page.waitForTimeout(150); // clicks right after a drag are swallowed on purpose
    await itemId(page, "p-cheese").getByTestId("rack-card").click();
    const dialog = page.getByTestId("rack-detail");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("rack-add").click();
    await expect(page.getByTestId("bar-count")).toHaveText("1");
    await dialog.getByTestId("rack-close").click();
    await expect(dialog).toHaveCount(0);
    await expect(itemId(page, "p-cheese").getByTestId("rack-card")).toBeFocused();
  });
});
