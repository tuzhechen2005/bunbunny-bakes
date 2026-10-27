// N2: weekday tags, WEEKDAY date cards and the C1 date hints (REDUCE / SPLIT) against mocked APIs.
import { expect, test, type Page } from "@playwright/test";
import { insertOrder, ITEM, resetAndSeed, withDb } from "./support/seed";

const CART_KEY = "bb_cart_v1";
const DATE_KEY = "bb_cart_date_v1";

const PRODUCTS = [
  { id: "p-bread", name: "奶酥红豆包", description: "", imageUrl: null, unitPriceCents: 249, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 1, pickupWeekdays: [] },
  { id: "p-puff", name: "泡芙", description: "", imageUrl: null, unitPriceCents: 399, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 1, pickupWeekdays: [3] },
  { id: "p-two", name: "吐司", description: "", imageUrl: null, unitPriceCents: 500, bundleSize: 1, bundlePriceCents: null, status: "ACTIVE", leadDays: 1, pickupWeekdays: [3, 6] },
];

type Item = { productId: string; qty: number };

const open = (date: string) => ({ date, state: "AVAILABLE", cutoffAt: "2026-11-30T01:00:00Z", cutoffLabel: "截止" });

async function mock(page: Page, dates: (items: Item[]) => unknown[], posted: unknown[] = [], orderFails = false) {
  await page.route("**/api/menu", (r) =>
    r.fulfill({ json: { orderingEnabled: true, products: PRODUCTS, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 } }),
  );
  await page.route("**/api/availability", (r) => {
    const body = r.request().postDataJSON() as { items: Item[] };
    r.fulfill({
      json: {
        orderingEnabled: true,
        pricing: { subtotalCents: 1000, deliveryFeeCents: 0, totalCents: 1000, freeDeliveryGapCents: 0 },
        cartProblems: [],
        dates: dates(body.items),
      },
    });
  });
  await page.route("**/api/orders", (r) => {
    posted.push(r.request().postDataJSON());
    if (orderFails) return r.fulfill({ status: 409, json: { error: "FULL", message: "x", suggestion: null } });
    r.fulfill({ status: 201, json: { orderNo: "1105-001", viewToken: "tok-split", url: "/o/tok-split" } });
  });
  await page.route("**/api/o/tok-split", (r) => r.fulfill({ status: 404, json: { error: "NOT_FOUND", message: "x" } }));
}

async function seed(page: Page, items: Item[], preferred?: string) {
  await page.goto("/");
  await page.evaluate(
    ([k, v, dk, dv]) => {
      localStorage.setItem(k, v);
      if (dv) localStorage.setItem(dk, dv);
    },
    [CART_KEY, JSON.stringify(items), DATE_KEY, preferred ?? ""] as const,
  );
  await page.goto("/checkout");
}

const card = (page: Page, date: string) => page.locator(`[data-testid="date-card"][data-date="${date}"]`);

test.describe("checkout hints", () => {
  test("weekday tag on the tile and the detail", async ({ page }) => {
    await mock(page, () => []);
    await page.goto("/");
    const puff = page.locator('[data-testid="product-card"][data-product-id="p-puff"]');
    await expect(puff.getByTestId("weekday-tag")).toHaveText("仅周三");
    await expect(page.locator('[data-testid="product-card"][data-product-id="p-two"]').getByTestId("weekday-tag")).toHaveText("仅周三、周六");
    await expect(page.locator('[data-testid="product-card"][data-product-id="p-bread"]').getByTestId("weekday-tag")).toHaveCount(0);
    await puff.getByTestId("tile-photo").click();
    await expect(page.getByTestId("detail-weekday")).toHaveText("仅周三");
  });

  test("a WEEKDAY date reads like an unavailable date with the reason", async ({ page }) => {
    await mock(page, () => [open("2026-11-04"), { date: "2026-11-05", state: "WEEKDAY" }]);
    await seed(page, [{ productId: "p-puff", qty: 1 }]);
    await expect(card(page, "2026-11-05")).toBeDisabled();
    await expect(card(page, "2026-11-05")).toContainText("泡芙仅周三");
  });

  test("REDUCE: one tap removes the pieces and selects the date", async ({ page }) => {
    const hints = [{ kind: "REDUCE", remove: [{ productId: "p-bread", qty: 1 }] }];
    await mock(page, (items) => {
      const fits = items.find((i) => i.productId === "p-bread")!.qty <= 2;
      return [open("2026-11-04"), fits ? open("2026-11-05") : { date: "2026-11-05", state: "FULL", hints }];
    });
    await seed(page, [{ productId: "p-bread", qty: 3 }]);
    await card(page, "2026-11-05").click();
    const row = page.getByTestId("hint-row");
    await expect(row).toContainText("去掉 1 个奶酥红豆包，就能订 11/5 周四");
    await row.getByTestId("hint-apply").click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("qty")).toHaveText("2");
    await expect(card(page, "2026-11-05")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((k) => localStorage.getItem(k), CART_KEY)).toBe(JSON.stringify([{ productId: "p-bread", qty: 2 }]));
  });

  for (const reason of ["CAPACITY", "WEEKDAY"] as const) {
    test(`SPLIT ${reason}: orders only the first part, leaves the rest, preselects the rest date, shows the second-order line`, async ({ page }) => {
      const posted: unknown[] = [];
      const here = [{ productId: "p-bread", qty: 2 }];
      const rest = [{ productId: "p-puff", qty: 1 }];
      const hint = { kind: "SPLIT", reason, here, rest, restDate: "2026-11-04" };
      await mock(
        page,
        (items) => {
          const isHere = items.length === 1 && items[0].productId === "p-bread";
          return [open("2026-11-04"), isHere ? open("2026-11-05") : { date: "2026-11-05", state: reason === "WEEKDAY" ? "WEEKDAY" : "FULL", hints: [hint] }];
        },
        posted,
      );
      await seed(page, [{ productId: "p-bread", qty: 2 }, { productId: "p-puff", qty: 1 }]);
      await card(page, "2026-11-05").click();
      const row = page.getByTestId("hint-row");
      if (reason === "CAPACITY") await expect(row).toContainText("11/5 周四 可以先订 2 个，剩下 1 个可以订 11/4 周三");
      else await expect(row).toContainText("泡芙只能周三取，可以分两单下");
      await expect(row.getByTestId("hint-apply")).toHaveText(reason === "CAPACITY" ? "先订周四" : "先订其他面包（周四）");
      await row.getByTestId("hint-apply").click();
      await expect(page.getByTestId("split-notice")).toBeVisible();
      await expect(page.getByTestId("cart-line")).toHaveCount(1);
      await expect(card(page, "2026-11-05")).toHaveAttribute("aria-pressed", "true");
      await page.getByLabel("微信号").fill("wx_test");
      await page.getByTestId("submit").click();
      await expect.poll(() => posted.length).toBe(1);
      expect((posted[0] as { items: Item[] }).items).toEqual(here);
      expect((posted[0] as { pickupDate: string }).pickupDate).toBe("2026-11-05");
      await expect(page).toHaveURL(/\/o\/tok-split/);
      expect(JSON.parse((await page.evaluate(() => sessionStorage.getItem("bunbunny:splitRest"))) ?? "null")).toEqual({
        token: "tok-split",
        items: [{ productId: "p-puff", name: "泡芙", qty: 1 }],
      });
      expect(await page.evaluate(([c, d]) => [localStorage.getItem(c), localStorage.getItem(d)], [CART_KEY, DATE_KEY] as const)).toEqual([
        JSON.stringify(rest),
        "2026-11-04",
      ]);
    });
  }

  test("split-in-split is impossible: no hints while a split is active, 改回 brings them back", async ({ page }) => {
    const hint = { kind: "SPLIT", reason: "CAPACITY", here: [{ productId: "p-bread", qty: 2 }, { productId: "p-two", qty: 1 }], rest: [{ productId: "p-puff", qty: 1 }], restDate: "2026-11-04" };
    await mock(page, (items) => [
      open("2026-11-04"),
      items.length === 3 ? { date: "2026-11-05", state: "FULL", hints: [hint] } : open("2026-11-05"),
      { date: "2026-11-07", state: "FULL", hints: [{ kind: "SPLIT", reason: "CAPACITY", here: [{ productId: "p-bread", qty: 2 }], rest: [{ productId: "p-two", qty: 1 }], restDate: "2026-11-04" }] },
    ]);
    await seed(page, [{ productId: "p-bread", qty: 2 }, { productId: "p-puff", qty: 1 }, { productId: "p-two", qty: 1 }]);
    await card(page, "2026-11-05").click();
    await page.getByTestId("hint-apply").click();
    await expect(page.getByTestId("split-notice")).toBeVisible();
    await card(page, "2026-11-07").click();
    await expect(page.getByTestId("hint-row")).toHaveCount(0);
    await expect(page.getByTestId("hint-apply")).toHaveCount(0);
    await page.getByTestId("split-undo").click();
    await card(page, "2026-11-07").click();
    await expect(page.getByTestId("hint-row")).toHaveCount(1);
  });

  test("a failed split order (409) leaves the bag and plan intact and writes no preferred date", async ({ page }) => {
    const posted: unknown[] = [];
    const whole = [{ productId: "p-bread", qty: 2 }, { productId: "p-puff", qty: 1 }];
    const hint = { kind: "SPLIT", reason: "CAPACITY", here: [{ productId: "p-bread", qty: 2 }], rest: [{ productId: "p-puff", qty: 1 }], restDate: "2026-11-04" };
    await mock(
      page,
      (items) => [open("2026-11-04"), items.length === 1 ? open("2026-11-05") : { date: "2026-11-05", state: "FULL", hints: [hint] }],
      posted,
      true,
    );
    await seed(page, whole);
    await card(page, "2026-11-05").click();
    await page.getByTestId("hint-apply").click();
    await page.getByLabel("微信号").fill("wx_test");
    await page.getByTestId("submit").click();
    await expect.poll(() => posted.length).toBe(1);
    await expect(page.getByTestId("submit-error")).toBeVisible();
    await expect(page.getByTestId("split-notice")).toBeVisible();
    expect(await page.evaluate(([c, d]) => [localStorage.getItem(c), localStorage.getItem(d)], [CART_KEY, DATE_KEY] as const)).toEqual([JSON.stringify(whole), null]);
  });

  test("the second-order note is dropped once the bag no longer holds the rest", async ({ page }) => {
    await mock(page, () => []);
    await page.goto("/");
    await page.evaluate(() => {
      sessionStorage.setItem("bunbunny:splitRest", JSON.stringify({ token: "tok-split", items: [{ productId: "p-puff", name: "泡芙", qty: 1 }] }));
    });
    await page.goto("/o/tok-split");
    await expect(page.getByTestId("split-rest")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("bunbunny:splitRest"))).toBeNull();
  });

  test("preferred date is preselected once and cleared", async ({ page }) => {
    await mock(page, () => [open("2026-11-04"), open("2026-11-05")]);
    await seed(page, [{ productId: "p-bread", qty: 1 }], "2026-11-05");
    await expect(card(page, "2026-11-05")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((k) => localStorage.getItem(k), DATE_KEY)).toBeNull();
  });

  test("a preferred date that is not open is dropped, nothing selected", async ({ page }) => {
    await mock(page, () => [open("2026-11-04"), { date: "2026-11-05", state: "CUTOFF" }]);
    await seed(page, [{ productId: "p-bread", qty: 1 }], "2026-11-05");
    await expect(page.getByTestId("date-card").first()).toBeVisible();
    await expect(page.locator('[data-testid="date-card"][aria-pressed="true"]')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), DATE_KEY)).toBeNull();
  });

  test("320 px wide with reduced motion: no horizontal scroll, 44 px button", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 640 });
    const hints = [{ kind: "REDUCE", remove: [{ productId: "p-bread", qty: 1 }] }];
    await mock(page, () => [open("2026-11-04"), { date: "2026-11-05", state: "FULL", hints }]);
    await seed(page, [{ productId: "p-bread", qty: 3 }]);
    await card(page, "2026-11-05").click();
    await expect(page.getByTestId("hint-row")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const b = (await page.getByTestId("hint-apply").boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/n2_checkout-hint-320.png" });
  });
});

// The same flows against the REAL server (no /api/availability or /api/orders mocks): the test DB is
// re-seeded; the cheese wedge is restricted to the weekday of the second open date.
test.describe("checkout hints, real API", () => {
  test.describe.configure({ mode: "serial" });

  test("WEEKDAY + SPLIT: the first order holds only the bread, the wedge stays in the bag with its date", async ({ page }) => {
    const seeded = await resetAndSeed();
    const { red, wedge } = seeded.products;
    const { d1, d2 } = seeded.dates;
    const wd = new Date(`${d2}T00:00:00Z`).getUTCDay();
    await withDb((c) => c.query(`UPDATE "Product" SET "pickupWeekdays" = $1 WHERE id = $2`, [[wd], wedge]));
    await seed(page, [{ productId: red, qty: 2 }, { productId: wedge, qty: 1 }]);
    await expect(card(page, d1)).toHaveAttribute("data-state", "WEEKDAY");
    await expect(card(page, d1)).toContainText("奶酪角仅周");
    await card(page, d1).click();
    const row = page.locator('[data-testid="hint-row"][data-kind="SPLIT_WEEKDAY"]');
    await expect(row).toContainText("奶酪角只能周");
    await row.getByTestId("hint-apply").click();
    await expect(page.getByTestId("split-notice")).toBeVisible();
    await expect(card(page, d1)).toHaveAttribute("data-state", "AVAILABLE");
    await page.getByLabel("微信号").fill("wx_real_split");
    await page.getByTestId("submit").click();
    await expect(page).toHaveURL(/\/o\//);
    const ordered = await withDb((c) =>
      c.query<{ productId: string; qty: number }>(
        `SELECT oi."productId", oi.qty FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE o."wechatId" = 'wx_real_split'`,
      ),
    );
    expect(ordered.rows).toEqual([{ productId: red, qty: 2 }]);
    expect(await page.evaluate(([c, d]) => [localStorage.getItem(c), localStorage.getItem(d)], [CART_KEY, DATE_KEY] as const)).toEqual([
      JSON.stringify([{ productId: wedge, qty: 1 }]),
      d2,
    ]);
    await page.goto("/checkout");
    await expect(card(page, d2)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((k) => localStorage.getItem(k), DATE_KEY)).toBeNull();
  });

  test("FULL + REDUCE: one tap drops a piece and the date becomes orderable", async ({ page }) => {
    const seeded = await resetAndSeed();
    const { red } = seeded.products;
    const { d3 } = seeded.dates;
    // 20 x 70 g = 1400 of 1600 g: 200 g left, so 2 red beans fit and 3 do not.
    await insertOrder({ date: d3, wechatId: "full_wx", status: "CONFIRMED", items: [ITEM.red(red, 20)] });
    await seed(page, [{ productId: red, qty: 3 }]);
    await expect(card(page, d3)).toHaveAttribute("data-state", "FULL");
    await card(page, d3).click();
    const row = page.locator('[data-testid="hint-row"][data-kind="REDUCE"]');
    await expect(row).toContainText("去掉 1 个奶酥红豆包，就能订");
    await row.getByTestId("hint-apply").click();
    await expect(page.getByTestId("qty")).toHaveText("2");
    await expect(card(page, d3)).toHaveAttribute("data-state", "AVAILABLE");
    await expect(card(page, d3)).toHaveAttribute("aria-pressed", "true");
  });
});
