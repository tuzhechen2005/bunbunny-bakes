import { expect, test, type Page } from "@playwright/test";

const PRODUCTS = [
  { id: "p-a", name: "奶酥红豆包", description: "红豆馅", imageUrl: null, unitPriceCents: 250, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 1 },
  { id: "p-b", name: "奶酪角", description: "奶酪", imageUrl: null, unitPriceCents: 300, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 1 },
];

async function mockMenu(page: Page, orderingEnabled = true) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled,
        products: PRODUCTS,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 8,
      },
    }),
  );
}

const plus = (page: Page, id: string) =>
  page.locator(`[data-testid="product-card"][data-product-id="${id}"]`).getByRole("button", { name: "增加一个" });

test("bag: empty state, then three quick adds give count 3 and never block clicks", async ({ page }) => {
  await mockMenu(page);
  await page.goto("/");
  await expect(page.getByTestId("bag-empty")).toHaveText("纸袋还是空的，去绳子上挑一个吧。");
  await expect(page.getByTestId("bag-checkout")).toBeDisabled();
  await expect(page.getByTestId("paper-bag-icon")).toBeVisible();

  await expect(page.getByTestId("fly-layer")).toHaveCSS("pointer-events", "none");
  const button = plus(page, "p-a");
  await button.click();
  await button.click();
  await plus(page, "p-b").click(); // clicks land while earlier flights are still in the air
  await expect(page.getByTestId("bag-count")).toHaveText("已选 3 件");
  await expect(page.getByTestId("bag-subtotal")).toHaveText("小计 $8.00");
  await expect(page.getByTestId("bag-empty")).toHaveCount(0);
  await expect(page.getByTestId("bag-checkout")).toBeEnabled();
  // flights land and remove themselves
  await expect(page.getByTestId("fly-thumb")).toHaveCount(0);
});

test("bag: a flight is visible in the air and the landing swings the bag, which then rests", async ({ page }) => {
  await mockMenu(page);
  await page.goto("/");
  const swing = page.getByTestId("bag-target").locator("> div");
  await plus(page, "p-a").click();
  await expect(page.getByTestId("fly-thumb")).toHaveCount(1);
  await expect.poll(async () => swing.evaluate((el) => (el as HTMLElement).style.transform)).toMatch(/rotate/);
  await expect
    .poll(async () => swing.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 4000 })
    .toBe("");
});

test("bag: reduced motion has no flight and no swing, the bag just updates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockMenu(page);
  await page.goto("/");
  await plus(page, "p-a").click();
  await plus(page, "p-a").click();
  await expect(page.getByTestId("fly-thumb")).toHaveCount(0);
  await expect(page.getByTestId("bag-count")).toHaveText("已选 2 件");
  await expect(page.getByTestId("bag-subtotal")).toHaveText("小计 $5.00");
  const swing = page.getByTestId("bag-target").locator("> div");
  expect(await swing.evaluate((el) => (el as HTMLElement).style.transform)).toBe("");
});

test("bag: ordering closed disables checkout but allows adding", async ({ page }) => {
  await mockMenu(page, false);
  await page.goto("/");
  await plus(page, "p-a").click();
  await expect(page.getByTestId("bag-count")).toHaveText("已选 1 件");
  await expect(page.getByTestId("bag-checkout")).toHaveText("暂未开放预订");
  await expect(page.getByTestId("bag-checkout")).toBeDisabled();
});

test("bag: no horizontal scroll at 320 px and the checkout button is a 44 px target", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockMenu(page);
  await page.goto("/");
  await plus(page, "p-a").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.getByTestId("bag-checkout").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
