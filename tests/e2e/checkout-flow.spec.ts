// J3: checkout behaviour of the continuous flow (skeletons, focus, snapping, blocked reasons,
// leaving mid-submit) against mocked customer APIs.
import { expect, test, type Page, type Route } from "@playwright/test";

const CART_KEY = "bb_cart_v1";

const PRODUCTS = [
  { id: "p-cheese", name: "奶酪角", description: "", imageUrl: null, unitPriceCents: 299, bundleSize: 4, bundlePriceCents: 1099, status: "ACTIVE", leadDays: 1 },
  { id: "p-redbean", name: "奶酥红豆包", description: "", imageUrl: null, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p-paused", name: "菠萝包", description: "", imageUrl: null, unitPriceCents: 300, bundleSize: 1, bundlePriceCents: null, status: "PAUSED", leadDays: 1 },
];

function availability(items: { productId: string; qty: number }[]) {
  const subtotal = items.reduce((s, i) => s + i.qty * (PRODUCTS.find((p) => p.id === i.productId)?.unitPriceCents ?? 0), 0);
  return {
    orderingEnabled: true,
    pricing: { subtotalCents: subtotal, deliveryFeeCents: 0, totalCents: subtotal, freeDeliveryGapCents: 0 },
    cartProblems: [],
    dates: [
      { date: "2026-10-30", state: "AVAILABLE", cutoffAt: "2026-10-30T01:00:00Z", cutoffLabel: "10/29 周四 20:00 截止" },
      { date: "2026-10-31", state: "FULL" },
      { date: "2026-11-01", state: "CUTOFF" },
      { date: "2026-11-02", state: "AVAILABLE", cutoffAt: "2026-11-01T01:00:00Z", cutoffLabel: "10/31 周六 20:00 截止" },
      { date: "2026-11-03", state: "AVAILABLE", cutoffAt: "2026-11-02T01:00:00Z", cutoffLabel: "11/1 周日 20:00 截止" },
      { date: "2026-11-04", state: "AVAILABLE", cutoffAt: "2026-11-03T01:00:00Z", cutoffLabel: "11/2 周一 20:00 截止" },
    ],
  };
}

async function mockApis(
  page: Page,
  opts: { availabilityDelay?: Promise<void>; orders?: (route: Route) => Promise<void> } = {},
) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled: true,
        products: PRODUCTS,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 8,
      },
    }),
  );
  await page.route("**/api/availability", async (route) => {
    await opts.availabilityDelay;
    const body = route.request().postDataJSON() as { items: { productId: string; qty: number }[] };
    await route.fulfill({ json: availability(body.items) });
  });
  await page.route("**/api/orders", async (route) => {
    if (opts.orders) return opts.orders(route);
    await route.fulfill({ status: 201, json: { orderNo: "1030-001", viewToken: "tok123", url: "/o/tok123" } });
  });
}

async function seedCart(page: Page, items: { productId: string; qty: number }[]) {
  await page.goto("/");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [CART_KEY, JSON.stringify(items)] as const);
  await page.goto("/checkout");
}

test.describe("checkout", () => {
  test("four skeleton date cards (100 x 112, rounded 20) show while the dates load", async ({ page }) => {
    let release!: () => void;
    const availabilityDelay = new Promise<void>((r) => (release = r));
    await mockApis(page, { availabilityDelay });
    await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
    const skeleton = page.getByTestId("dates-skeleton");
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator("div.ui-skel.flex-none")).toHaveCount(4);
    const box = (await skeleton.locator("div.ui-skel.flex-none").first().boundingBox())!;
    expect(Math.round(box.width)).toBe(100);
    expect(Math.round(box.height)).toBe(112);
    const radius = await skeleton.locator("div.ui-skel.flex-none").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).toBe("20px");
    // The real page chrome is already there: top bar, title, the cart line.
    await expect(page.getByTestId("top-bar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("确认预订");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    release();
    await expect(page.getByTestId("date-card").first()).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });

  test("the top bar is 56 px with a 44 px chevron that goes back to the menu", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
    const bar = page.getByTestId("top-bar");
    await expect(bar).toBeVisible();
    expect(Math.round((await bar.boundingBox())!.height)).toBe(56);
    const back = page.getByTestId("top-bar-back");
    const b = (await back.boundingBox())!;
    expect(Math.round(b.width)).toBe(44);
    expect(Math.round(b.height)).toBe(44);
    await expect(back).toHaveAttribute("aria-label", "返回菜单");
    await back.click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the date list snaps to its cards", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
    const first = page.getByTestId("date-card").first();
    await expect(first).toBeVisible();
    expect(await first.evaluate((el) => getComputedStyle(el).scrollSnapAlign)).toBe("start");
    const list = first.locator("xpath=..");
    const style = await list.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { type: cs.scrollSnapType, padding: cs.scrollPaddingLeft };
    });
    expect(style.type).toBe("x mandatory");
    expect(style.padding).toBe("20px");
  });

  test("the WeChat underline is ink and thick on focus, red only when invalid", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
    const input = page.getByLabel("微信号");
    await expect(input).toBeVisible();
    const look = () =>
      input.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.borderBottomColor, width: cs.borderBottomWidth, shadow: cs.boxShadow };
      });
    const ink = "rgb(22, 20, 18)";
    const red = "rgb(224, 52, 75)";
    const rest = await look();
    expect(rest.color).not.toBe(ink);
    expect(rest.color).not.toBe(red);
    await input.focus();
    await expect.poll(async () => (await look()).color).toBe(ink);
    const focused = await look();
    expect(focused.width).toBe("2px");
    expect(focused.shadow).toContain("0px 1px 0px 0px"); // 2 px border + 1 px line = 3 px of ink
    // Invalid: red, not ink.
    await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("wechat-error")).toBeVisible();
    await expect.poll(async () => (await look()).color).toBe(red);
  });

  test("the note counter appears from 240 characters", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
    const note = page.getByLabel("备注");
    await note.fill("x".repeat(239));
    await expect(page.getByTestId("note-counter")).toHaveCount(0);
    await note.fill("x".repeat(240));
    await expect(page.getByTestId("note-counter")).toHaveText("240/300");
  });

  test("a paused line explains why 确认提交预订 is disabled", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [
      { productId: "p-redbean", qty: 1 },
      { productId: "p-paused", qty: 1 },
    ]);
    await expect(page.getByTestId("submit")).toBeDisabled();
    await expect(page.getByTestId("submit-blocked")).toHaveText("有商品暂停供应，请先移除");
    await page.getByRole("button", { name: "移除" }).click();
    await expect(page.getByTestId("submit-blocked")).toHaveCount(0);
    await expect(page.getByTestId("submit")).toBeEnabled();
  });

  test("the footer sits outside the padded column (no double indent)", async ({ page }) => {
    await mockApis(page);
    await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
    await expect(page.getByTestId("date-card").first()).toBeVisible();
    const footer = page.locator("footer");
    const logo = footer.locator("img").first();
    const f = (await footer.boundingBox())!;
    const l = (await logo.boundingBox())!;
    const main = (await page.getByRole("main").boundingBox())!;
    expect(Math.round(f.x)).toBe(Math.round(main.x)); // the footer spans the column
    expect(Math.round(l.x - f.x)).toBe(20); // its own 20 px, not 40
  });

  test("a second order in the same tab starts from a fresh checkout", async ({ page }) => {
    await mockApis(page);
    await page.route("**/api/o/tok123", (route) =>
      route.fulfill({
        json: {
          orderNo: "1030-001", items: [{ name: "奶酥红豆包", qty: 2, lineTotalCents: 498, imageUrl: null }], subtotalCents: 498,
          deliveryFeeCents: 0, totalCents: 498, pickupDate: "2026-10-30", pickupDateLabel: "10/30 周五", fulfillment: "PICKUP",
          statusText: "已确认", statusKind: "CONFIRMED", ownerWechatId: "", pickupNote: null, canCancel: false,
          cancelDeadlineLabel: null, note: null,
        },
      }),
    );
    await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
    await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
    await page.getByLabel("微信号").fill("bunny_fan_01");
    await page.getByTestId("submit").click();
    await page.waitForURL(/\/o\/tok123/);
    await expect(page.getByTestId("status-text")).toBeVisible();

    // Client navigation home, a different bread, the bag, 去结算 again.
    await page.getByRole("link", { name: "返回", exact: true }).click(); // the order page's (checkout is kept hidden)
    await expect(page).toHaveURL(/\/$/);
    await page.locator('[data-testid="product-card"][data-product-id="p-cheese"]').getByRole("button", { name: "增加一个" }).click();
    await expect(page.getByTestId("bag-badge")).toHaveText("1", { timeout: 6000 });
    await page.getByTestId("bag-pill").click();
    await page.getByTestId("bag-checkout").click();
    await expect(page).toHaveURL(/\/checkout$/);
    const lines = page.getByTestId("cart-line");
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toHaveAttribute("data-product-id", "p-cheese");
    await expect(page.getByTestId("submit")).toBeEnabled();
    await expect(page.getByTestId("submit")).toHaveText("确认提交预订");
    await expect(page.getByTestId("date-card").first()).toBeVisible();
    // The date has to be chosen again.
    await expect(page.locator('[data-testid="date-card"][aria-pressed="true"]')).toHaveCount(0);
  });

  test("the line controls are locked while the order is being sent", async ({ page }) => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    await mockApis(page, {
      orders: async (route) => {
        await hold;
        await route.fulfill({ status: 500, json: { error: "BOOM", message: "x" } });
      },
    });
    await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
    await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
    await page.getByLabel("微信号").fill("bunny_fan_01");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit")).toHaveText("提交中…");
    const line = page.getByTestId("cart-line").first();
    await expect(line.getByRole("button", { name: /增加一个/ })).toBeDisabled();
    await expect(line.getByRole("button", { name: /减少一个/ })).toBeDisabled();
    release();
    await expect(page.getByTestId("submit")).toBeEnabled();
    await expect(line.getByRole("button", { name: /增加一个/ })).toBeEnabled();
  });

  test("leaving mid-submit: the response is still handled, nothing hijacks the page", async ({ page }) => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    await mockApis(page, {
      orders: async (route) => {
        await hold;
        await route.fulfill({ status: 201, json: { orderNo: "1030-007", viewToken: "tok777", url: "/o/tok777" } });
      },
    });
    await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
    await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
    await page.getByLabel("微信号").fill("bunny_fan_01");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit")).toHaveText("提交中…");

    await page.getByTestId("top-bar-back").click(); // leave to the home page while the POST is in flight
    await expect(page).toHaveURL(/\/$/);
    release();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("bb_orders_v1")))
      .toContain("tok777");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bb_orders_v1") ?? "[]")[0])).toMatchObject({
      token: "tok777",
      orderNo: "1030-007",
    });
    expect(await page.evaluate(() => localStorage.getItem("bb_pending_save_v1"))).toContain("tok777");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/$/); // still on the home page
    expect(await page.evaluate((k) => localStorage.getItem(k), CART_KEY)).toBe("[]");
  });
});
