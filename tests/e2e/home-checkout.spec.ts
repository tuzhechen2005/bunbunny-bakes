// Home + checkout against mocked customer APIs (docs/API_SPEC.md §2).
import { expect, test, type Page, type Route } from "@playwright/test";
import { addFromTile, closeDetail, openTile } from "./support/addFromTile";

const CART_KEY = "bb_cart_v1";

type Product = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  status: "ACTIVE" | "PAUSED";
  leadDays: number;
};

const PRODUCTS: Product[] = [
  { id: "p-redbean", name: "奶酥红豆包", description: "红豆馅", imageUrl: null, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p-cheese", name: "奶酪角", description: "奶酪", imageUrl: null, unitPriceCents: 299, bundleSize: 4, bundlePriceCents: 1099, status: "ACTIVE", leadDays: 1 },
  { id: "p-brulee", name: "焦糖布蕾", description: "布蕾", imageUrl: null, unitPriceCents: 450, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 2 },
  { id: "p-tart", name: "法式塔", description: "塔", imageUrl: null, unitPriceCents: 500, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 3 },
  { id: "p-paused", name: "菠萝包", description: "暂停中", imageUrl: null, unitPriceCents: 300, bundleSize: 1, bundlePriceCents: null, status: "PAUSED", leadDays: 1 },
];

function menuBody(overrides: Record<string, unknown> = {}) {
  return {
    orderingEnabled: true,
    products: PRODUCTS,
    pickupNote: "自提时间在下午 5 点以后，具体时间微信确认",
    deliveryFeeCents: 500,
    freeDeliveryMinCents: 2500,
    maxQtyPerItem: 8,
    ...overrides,
  };
}

function lineTotal(qty: number, p: Product) {
  if (p.bundlePriceCents === null) return qty * p.unitPriceCents;
  return Math.floor(qty / p.bundleSize) * p.bundlePriceCents + (qty % p.bundleSize) * p.unitPriceCents;
}

type CartProblem = { productId: string; error: string };

function availabilityBody(
  items: { productId: string; qty: number }[],
  fulfillment: string,
  cartProblems: CartProblem[] = [],
) {
  const subtotal = items.reduce((s, i) => s + lineTotal(i.qty, PRODUCTS.find((p) => p.id === i.productId)!), 0);
  const fee = fulfillment === "DELIVERY" && subtotal < 2500 ? 500 : 0;
  return {
    orderingEnabled: true,
    pricing: { subtotalCents: subtotal, deliveryFeeCents: fee, totalCents: subtotal + fee, freeDeliveryGapCents: Math.max(0, 2500 - subtotal) },
    cartProblems,
    dates: [
      { date: "2026-10-30", state: "AVAILABLE", cutoffAt: "2026-10-30T01:00:00Z", cutoffLabel: "10/29 周四 20:00 截止" },
      { date: "2026-10-31", state: "FULL" },
      { date: "2026-11-01", state: "CUTOFF" },
      fulfillment === "DELIVERY"
        ? { date: "2026-11-02", state: "DELIVERY_FULL" }
        : { date: "2026-11-02", state: "AVAILABLE", cutoffAt: "2026-11-01T01:00:00Z", cutoffLabel: "10/31 周六 20:00 截止" },
    ],
  };
}

type OrderHandler = (route: Route, body: Record<string, unknown>, n: number) => Promise<void>;

async function mockApis(
  page: Page,
  opts: {
    menu?: Record<string, unknown>;
    orders?: OrderHandler;
    cartProblems?: (items: { productId: string; qty: number }[]) => CartProblem[];
  } = {},
) {
  const orderBodies: Record<string, unknown>[] = [];
  await page.route("**/api/menu", (route) => route.fulfill({ json: menuBody(opts.menu) }));
  await page.route("**/api/availability", (route) => {
    const body = route.request().postDataJSON() as { items: { productId: string; qty: number }[]; fulfillment: string };
    return route.fulfill({
      json: availabilityBody(body.items, body.fulfillment, opts.cartProblems?.(body.items) ?? []),
    });
  });
  await page.route("**/api/orders", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    orderBodies.push(body);
    if (opts.orders) return opts.orders(route, body, orderBodies.length);
    return route.fulfill({ status: 201, json: { orderNo: "1030-001", viewToken: "tok123", url: "/o/tok123" } });
  });
  return orderBodies;
}

async function seedCart(page: Page, items: { productId: string; qty: number }[]) {
  await page.goto("/");
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [CART_KEY, JSON.stringify(items)] as const);
  await page.goto("/checkout");
}

function card(page: Page, id: string) {
  return page.locator(`[data-testid="product-card"][data-product-id="${id}"]`);
}

async function fillAndPickDate(page: Page, date = "2026-10-30") {
  await page.locator(`[data-testid="date-card"][data-date="${date}"]`).click();
  await page.getByLabel("微信号").fill("  bunny_fan_01  ");
}

test("home: add items updates the bag bar; placeholder; open state", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  await expect(page.getByRole("img", { name: "兔的大面包" }).first()).toBeVisible();
  await expect(page.getByTestId("ordering-state")).toHaveText("预订开放中");
  await expect(card(page, "p-redbean").getByTestId("price")).toHaveText("$2.49");
  await expect(card(page, "p-redbean").getByTestId("bundle-price")).toHaveText("4 个 $8.99");
  await expect(card(page, "p-brulee").getByTestId("price")).toHaveText("$4.50");
  await expect(card(page, "p-brulee").getByTestId("bundle-price")).toHaveCount(0);
  await expect(card(page, "p-redbean").getByTestId("bunny-placeholder")).toBeVisible();
  await expect(page.getByTestId("footer-contact")).toHaveCount(0);

  // The tiles have no add or stepper (D97): the bread goes in from the detail, comes out in the bag sheet.
  await expect(card(page, "p-cheese").getByRole("button", { name: /增加一个|放进纸袋/ })).toHaveCount(0);
  await addFromTile(page, "p-cheese", 5);
  await expect(page.getByTestId("bag-count")).toContainText("5");
  await expect(page.getByTestId("bag-subtotal")).toContainText("13.98");
  await addFromTile(page, "p-redbean");
  await expect(page.getByTestId("bag-subtotal")).toContainText("16.47");
  await page.getByTestId("bag-pill").click();
  await page.getByTestId("bag-line").filter({ hasText: "奶酪角" }).getByTestId("bag-line-dec").click();
  await page.getByTestId("bag-close").click();
  await expect(page.getByTestId("bag-count")).toContainText("5");
  await expect(page.getByTestId("bag-subtotal")).toContainText("13.48");

  // persisted across reloads
  await page.reload();
  await expect(page.getByTestId("bag-count")).toContainText("5");
});

test("home: paused card disabled, max reached, footer wechat, vanished items dropped", async ({ page }) => {
  await mockApis(page, { menu: { ownerWechatId: "bunbunny_owner" } });
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify([{ productId: "gone", qty: 3 }, { productId: "p-redbean", qty: 1 }])), CART_KEY);
  await page.reload();
  await expect(page.getByTestId("bag-count")).toContainText("1");
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBe(JSON.stringify([{ productId: "p-redbean", qty: 1 }]));

  const paused = card(page, "p-paused");
  await expect(paused).toHaveAttribute("data-paused", "true");
  await expect(paused.getByText("暂停供应")).toBeVisible();
  // A paused bread still opens its detail, but cannot go in the bag.
  await openTile(page, "p-paused");
  await expect(page.getByTestId("detail-add")).toBeDisabled();
  await expect(page.getByTestId("detail")).toContainText("暂停供应");
  await closeDetail(page);

  await openTile(page, "p-redbean");
  await expect(page.getByTestId("detail")).not.toContainText("大量订购请加微信联系");
  for (let i = 1; i < 7; i++) await page.getByTestId("detail-inc").click();
  await page.getByTestId("detail-add").click();
  await expect(page.getByTestId("bag-count")).toContainText("8");
  await expect(page.getByTestId("detail-add")).toBeDisabled();
  await expect(page.getByTestId("detail-inc")).toBeDisabled();
  await expect(page.getByTestId("detail")).toContainText("大量订购请加微信联系");
  await closeDetail(page);
  await expect(page.getByTestId("footer-contact")).toHaveText("微信 bunbunny_owner");

  await page.getByTestId("bag-pill").click();
  await page.getByTestId("bag-checkout").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
});

test("home: ordering closed disables the checkout button but allows adding", async ({ page }) => {
  await mockApis(page, { menu: { orderingEnabled: false } });
  await page.goto("/");
  await expect(page.getByText("暂未开放预订 🍞")).toBeVisible();
  await expect(page.getByText("下一轮预订开放时间请关注群内通知～")).toBeVisible();
  await addFromTile(page, "p-redbean");
  await expect(page.getByTestId("bag-count")).toContainText("1");
  await page.getByTestId("bag-pill").click();
  const button = page.getByTestId("bag-checkout");
  await expect(button).toHaveText("暂未开放预订");
  await expect(button).toBeDisabled();
});

test("checkout: lines, date states, brûlée hint, delivery gap", async ({ page }) => {
  await mockApis(page);
  await seedCart(page, [{ productId: "p-cheese", qty: 5 }, { productId: "p-brulee", qty: 1 }]);
  const cheese = page.locator('[data-testid="cart-line"][data-product-id="p-cheese"]');
  // The line says the name only: the quantity lives in the stepper, never repeated as 「×5」.
  await expect(cheese).toContainText("奶酪角");
  await expect(cheese).not.toContainText("×");
  await expect(cheese.getByTestId("qty")).toHaveText("5");
  await expect(cheese.getByRole("button", { name: "增加一个 奶酪角" })).toBeVisible();
  await expect(cheese.getByTestId("line-breakdown")).toHaveText("$10.99 + $2.99 = $13.98");
  await expect(page.getByTestId("lead-hint")).toHaveText("焦糖布蕾需提前 2 天");

  const date = (d: string) => page.locator(`[data-testid="date-card"][data-date="${d}"]`);
  await expect(date("2026-10-30")).toContainText("10/30 周五");
  await expect(date("2026-10-30")).toContainText("10/29 周四 20:00 截止");
  await expect(date("2026-10-30")).toBeEnabled();
  await expect(date("2026-10-31")).toContainText("已满");
  await expect(date("2026-10-31")).toBeDisabled();
  await expect(date("2026-11-01")).toContainText("已截止");
  await expect(date("2026-11-01")).toBeDisabled();
  await expect(page.getByTestId("pickup-note")).toHaveText("自提时间在下午 5 点以后，具体时间微信确认");
  await expect(page.getByTestId("total-total")).toHaveText("$18.48");
  await expect(page.getByTestId("total-fee")).toHaveCount(0); // delivery fee row only for delivery

  // select 11/2, then switch to delivery: 11/2 becomes DELIVERY_FULL and is deselected
  await date("2026-11-02").click();
  await expect(date("2026-11-02")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("配送").check();
  await expect(date("2026-11-02")).toContainText("配送已满，可选自提");
  await expect(date("2026-11-02")).toBeDisabled();
  await expect(date("2026-11-02")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("delivery-fee")).toHaveText("满 $25 免运费");
  await expect(page.getByTestId("delivery-gap")).toHaveText("还差 $6.52");
  await expect(page.getByText("具体配送时间和地点会在微信上和你确认")).toBeVisible();
  await expect(page.getByTestId("total-fee")).toHaveText("$5.00");
  await expect(page.getByTestId("total-total")).toHaveText("$23.48");

  // qty editing re-queries: removing the brûlée drops the hint and updates totals
  const brulee = page.locator('[data-testid="cart-line"][data-product-id="p-brulee"]');
  await brulee.getByRole("button", { name: "减少一个" }).click();
  await expect(page.getByTestId("lead-hint")).toHaveCount(0);
  // delivery stays selected: $13.98 + $5.00 fee (the subtotal row is gone in v2, the total says it all)
  await expect(page.getByTestId("total-fee")).toHaveText("$5.00");
  await expect(page.getByTestId("total-total")).toHaveText("$18.98");

  // honeypot present, hidden and empty
  const honeypot = page.locator('input[name="website"]');
  await expect(honeypot).toHaveCount(1);
  await expect(honeypot).toHaveValue("");
  await expect(honeypot).toHaveAttribute("tabindex", "-1");
  await expect(honeypot).toHaveAttribute("autocomplete", "off");
});

test("checkout: happy path submits once, navigates and clears the cart", async ({ page }) => {
  const bodies = await mockApis(page, {
    orders: async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 201, json: { orderNo: "1030-001", viewToken: "tok123", url: "/o/tok123" } });
    },
  });
  await seedCart(page, [{ productId: "p-redbean", qty: 4 }]);
  await fillAndPickDate(page);
  await page.getByLabel("备注").fill("谢谢");
  await expect(page.getByTestId("note-counter")).toHaveCount(0); // only shown from 240 characters
  // The form stays on screen until the page changes: no full-screen "submitted" state, no empty-cart flash.
  await page.evaluate(() => {
    const w = window as unknown as { __flash: boolean };
    w.__flash = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="empty-cart"]')) w.__flash = true;
    }).observe(document.body, { childList: true, subtree: true });
  });

  // double tap: two clicks in the same task, before React re-renders
  await page.getByTestId("submit").evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(page.getByTestId("submit")).toHaveText("提交中…");
  await expect(page.getByTestId("submit")).toBeDisabled();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await page.waitForURL(/\/o\/tok123\?new=1$/);
  expect(await page.evaluate(() => (window as unknown as { __flash: boolean }).__flash)).toBe(false);
  expect(bodies).toHaveLength(1);
  const body = bodies[0];
  expect(body).toMatchObject({
    items: [{ productId: "p-redbean", qty: 4 }],
    pickupDate: "2026-10-30",
    fulfillment: "PICKUP",
    wechatId: "bunny_fan_01",
    note: "谢谢",
    website: "",
  });
  expect(body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(Object.keys(body).sort()).toEqual(["fulfillment", "idempotencyKey", "items", "note", "pickupDate", "website", "wechatId"]);
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBe("[]");
  // the order page draws the ordered bread in the bag: best-effort sessionStorage hand-off
  const lastBag = await page.evaluate(() => sessionStorage.getItem("bunbunny:lastBag"));
  expect(JSON.parse(lastBag ?? "null")).toEqual({
    orderNo: "1030-001",
    token: "tok123",
    items: [{ name: "奶酥红豆包", imageUrl: null, qty: 4 }],
  });
});

test("checkout: errors sit under their block", async ({ page }) => {
  await mockApis(page, {
    orders: (route) => route.fulfill({ status: 409, json: { error: "RATE_LIMITED", message: "x" } }),
  });
  await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
  await expect(page.getByTestId("date-card").first()).toBeVisible();
  await page.getByTestId("submit").click();
  // missing date: inside the date block; missing WeChat id: right under the input
  await expect(page.getByTestId("dates").getByTestId("submit-error")).toHaveText("请先选择取货日期");
  await expect(page.getByTestId("wechat-error")).toHaveText("请填写你的微信号");
  await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
  await expect(page.getByTestId("submit-error")).toHaveCount(0);
  await page.getByLabel("微信号").fill("bunny_fan_01");
  await expect(page.getByTestId("wechat-error")).toHaveCount(0);
  // a whole-order error (not about the date) shows just above the submit button
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("submit-error")).toHaveText("提交太频繁了，请稍后再试，或加微信联系店主");
  await expect(page.getByTestId("dates").getByTestId("submit-error")).toHaveCount(0);
});

test("checkout: FULL with suggestion offers a date switch, without auto-submitting", async ({ page }) => {
  const bodies = await mockApis(page, {
    orders: (route) =>
      route.fulfill({ status: 409, json: { error: "FULL", message: "x", suggestion: "2026-11-02" } }),
  });
  await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
  await fillAndPickDate(page);
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("submit-error")).toContainText("这一天的预订名额已经满啦，可以选择下一个有空位的日期～");
  await expect(page.getByTestId("submit")).toBeEnabled();
  await page.getByRole("button", { name: "改成 11/2 周一" }).click();
  await expect(page.locator('[data-testid="date-card"][data-date="2026-11-02"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="date-card"][data-date="2026-10-30"]')).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(300);
  expect(bodies).toHaveLength(1);
});

test("checkout: FULL without suggestion and other errors", async ({ page }) => {
  const responses = [
    { status: 409, json: { error: "FULL", message: "x", suggestion: null } },
    { status: 409, json: { error: "DELIVERY_FULL", message: "x" } },
    { status: 409, json: { error: "CUTOFF_PASSED", message: "x" } },
    { status: 409, json: { error: "ORDERING_DISABLED", message: "x" } },
    { status: 429, json: { error: "RATE_LIMITED", message: "x" } },
    { status: 409, json: { error: "PRODUCT_UNAVAILABLE", message: "x" } },
    { status: 409, json: { error: "QTY_LIMIT", message: "x" } },
    { status: 409, json: { error: "DATE_CLOSED", message: "x" } },
    { status: 409, json: { error: "SOMETHING_NEW", message: "x" } },
    { status: 500, json: { error: "BOOM", message: "x" } },
  ];
  await mockApis(page, { orders: (route, _b, n) => route.fulfill(responses[n - 1]) });
  await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
  const expected = [
    "暂时没有可以容纳这个订单的日期，可以减少数量或加微信联系店主",
    "这一天的配送名额满了，可以改成自提～",
    "这一天已经截止啦，请选择其他日期",
    "暂未开放预订 🍞",
    "提交太频繁了，请稍后再试，或加微信联系店主",
    "有商品暂时不能预订，请从购物车移除后再提交",
    "有商品超过了每单的数量上限，请减少数量",
    "这一天不接受预订，请选择其他日期",
    "提交失败，请稍后再试",
    "提交失败，请稍后再试",
  ];
  await fillAndPickDate(page);
  for (const text of expected) {
    await page.locator('[data-testid="date-card"][data-date="2026-10-30"]').click();
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit-error")).toHaveText(text);
    await expect(page.getByTestId("submit")).toBeEnabled();
  }
});

test("checkout: cart problems block submit until fixed", async ({ page }) => {
  // The server reports QTY_LIMIT for redbean above 3 (e.g. the max dropped after the menu loaded).
  const bodies = await mockApis(page, {
    cartProblems: (items) =>
      items.filter((i) => i.productId === "p-redbean" && i.qty > 3).map((i) => ({ productId: i.productId, error: "QTY_LIMIT" })),
  });
  await seedCart(page, [
    { productId: "p-paused", qty: 1 },
    { productId: "p-redbean", qty: 4 },
  ]);
  await fillAndPickDate(page);
  const submit = page.getByTestId("submit");
  const paused = page.locator('[data-testid="cart-line"][data-product-id="p-paused"]');
  const redbean = page.locator('[data-testid="cart-line"][data-product-id="p-redbean"]');

  await expect(paused).toContainText("暂停供应");
  await expect(redbean).toContainText("大量订购请加微信联系");
  await expect(submit).toBeDisabled();

  // removing the paused line still leaves the QTY_LIMIT problem
  await paused.getByRole("button", { name: "移除" }).click();
  await expect(paused).toHaveCount(0);
  await expect(submit).toBeDisabled();

  // reducing the qty clears the problem
  await redbean.getByRole("button", { name: "减少一个" }).click();
  await expect(redbean).not.toContainText("大量订购请加微信联系");
  await expect(submit).toBeEnabled();
  expect(bodies).toHaveLength(0);
});

test("checkout: VALIDATION gets a new idempotency key; network error keeps it", async ({ page }) => {
  const bodies = await mockApis(page, {
    orders: async (route, _b, n) => {
      if (n === 1) return route.abort("failed");
      if (n === 2) return route.fulfill({ status: 422, json: { error: "VALIDATION", message: "x", fields: { wechatId: "微信号格式不对" } } });
      return route.fulfill({ status: 201, json: { orderNo: "1030-002", viewToken: "tok456", url: "/o/tok456" } });
    },
  });
  await seedCart(page, [{ productId: "p-redbean", qty: 2 }]);
  await fillAndPickDate(page);

  await page.getByTestId("submit").click();
  await expect(page.getByTestId("submit-error")).toHaveText("提交失败，请稍后再试");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("wechat-error")).toHaveText("微信号格式不对");
  await page.getByLabel("微信号").fill("bunny_fan_02");
  await page.getByTestId("submit").click();
  await page.waitForURL(/\/o\/tok456\?new=1$/);

  expect(bodies).toHaveLength(3);
  expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  expect(bodies[2].idempotencyKey).not.toBe(bodies[1].idempotencyKey);
});

test("checkout: the lead hint names the product with the longest lead time (D96)", async ({ page }) => {
  await mockApis(page);
  await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
  await expect(page.getByTestId("date-card").first()).toBeVisible();
  await expect(page.getByTestId("lead-hint")).toHaveCount(0); // a 1-day product: nothing to say
  await seedCart(page, [{ productId: "p-redbean", qty: 1 }, { productId: "p-brulee", qty: 1 }]);
  await expect(page.getByTestId("lead-hint")).toHaveText("焦糖布蕾需提前 2 天");
  await seedCart(page, [{ productId: "p-brulee", qty: 1 }, { productId: "p-tart", qty: 1 }, { productId: "p-redbean", qty: 1 }]);
  await expect(page.getByTestId("lead-hint")).toHaveText("法式塔需提前 3 天");
});

test("checkout: client-side checks and empty cart", async ({ page }) => {
  const bodies = await mockApis(page);
  await seedCart(page, [{ productId: "p-redbean", qty: 1 }]);
  await expect(page.getByTestId("date-card").first()).toBeVisible();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("wechat-error")).toHaveText("请填写你的微信号");
  await expect(page.getByTestId("submit-error")).toHaveText("请先选择取货日期");
  expect(bodies).toHaveLength(0);

  await page.locator('[data-testid="cart-line"]').getByRole("button", { name: "减少一个" }).click();
  await expect(page.getByTestId("empty-cart")).toContainText("购物车还是空的～");
  await page.getByRole("link", { name: "回首页挑选面包" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("no horizontal scroll at 320px", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await seedCart(page, [{ productId: "p-cheese", qty: 5 }, { productId: "p-brulee", qty: 1 }]);
    await expect(page.getByTestId("date-card").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
