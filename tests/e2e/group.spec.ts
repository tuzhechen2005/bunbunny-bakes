// D192/D193 拼单 on the customer side against mocked APIs: rotation days on the flavours, the progress bar on the
// detail, the bar and the "没成团时" choice at checkout (sent with the order), and the line status on the order page.
import { expect, test, type Page } from "@playwright/test";

const CART_KEY = "bb_cart_v1";
const PLAIN = "f-plain";
const TEA = "f-tea";

const BASQUE = {
  id: "p-basque", name: "巴斯克蛋糕", description: "", imageUrl: null, images: [], isNew: false, unitPriceCents: 599, bundleSize: 6,
  bundlePriceCents: 2999, status: "ACTIVE", leadDays: 1, pickupWeekdays: [2, 4], field: { bg: "#e8b84b", ink: "#3a2a12", ink2: "#6b5430" },
  saleMode: "GROUP", groupMin: 4, batchYield: 6,
  flavors: [
    { id: PLAIN, name: "经典原味", priceCents: 599, bundlePriceCents: 2999, pickupWeekdays: [2] },
    { id: TEA, name: "大红袍红茶", priceCents: 599, bundlePriceCents: 2999, pickupWeekdays: [2] },
  ],
};
const BREAD = {
  id: "p-bread", name: "奶酥红豆包", description: "", imageUrl: null, images: [], isNew: false, unitPriceCents: 249, bundleSize: 4,
  bundlePriceCents: 899, status: "ACTIVE", leadDays: 1, pickupWeekdays: [], field: { bg: "#e8b84b", ink: "#3a2a12", ink2: "#6b5430" },
};

const pool = (date: string, flavorId: string, last: number, status = "OPEN"): Record<string, unknown> => ({
  date, productId: BASQUE.id, flavorId, pieces: last, min: 4, cakes: last ? 1 : 0, fullCakes: 0, last, spare: 6 - last, status, needMore: Math.max(0, 4 - last),
});

async function mock(page: Page, posted: Record<string, unknown>[] = []) {
  await page.route("**/api/menu", (r) =>
    r.fulfill({ json: { orderingEnabled: true, products: [BASQUE, BREAD], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 } }),
  );
  await page.route("**/api/group-pools?*", (r) =>
    r.fulfill({
      json: {
        pools: [
          pool("2026-11-17", PLAIN, 3),
          pool("2026-11-24", PLAIN, 0),
          pool("2026-11-17", TEA, 4, "FORMED"),
          // Ordered before 拼单 started: confirmed with a single piece; it says so instead of 已成团.
          pool("2026-11-19", TEA, 1, "CONFIRMED"),
        ],
      },
    }),
  );
  await page.route("**/api/availability", (r) =>
    r.fulfill({
      json: {
        orderingEnabled: true,
        pricing: { subtotalCents: 1198, deliveryFeeCents: 0, totalCents: 1198, freeDeliveryGapCents: 0 },
        cartProblems: [],
        dates: [{ date: "2026-11-17", state: "AVAILABLE", cutoffAt: "2026-11-17T02:00:00Z", cutoffLabel: "截止", soldOutFlavorIds: [], groupPools: [pool("2026-11-17", PLAIN, 3)] }],
      },
    }),
  );
  await page.route("**/api/orders", (r) => {
    posted.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, json: { orderNo: "1117-001", viewToken: "tok-group", url: "/o/tok-group" } });
  });
}

test.use({ reducedMotion: "reduce" });

test.describe("拼单 (customer)", () => {
  test("detail: rotation days on the flavours, the rule line, then the chosen flavour's bars", async ({ page }) => {
    await mock(page);
    await page.goto("/");
    await page.locator(`[data-testid="product-card"][data-product-id="${BASQUE.id}"]`).getByTestId("tile-photo").click();
    await expect(page.getByTestId(`detail-flavor-days-${PLAIN}`)).toHaveText("仅周二");
    const group = page.getByTestId("detail-group");
    await expect(group).toContainText("拼单：满 4 块开做（一只 6 块）");
    await expect(group.getByTestId("detail-pool")).toHaveCount(0);
    await page.getByTestId(`detail-flavor-${PLAIN}`).click();
    const rows = group.getByTestId("detail-pool");
    await expect(rows).toHaveCount(2);
    // Live: the 1 piece on the stepper counts. 3 ordered + 1 = the cake forms; an empty date shows only mine.
    await expect(rows.first()).toContainText("加上你的就成团");
    await expect(rows.first().getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    await expect(rows.nth(1)).toContainText("1/4 块（含你 1 块）· 还差 3 块");
    await page.getByTestId(`detail-flavor-${TEA}`).click();
    await expect(group.getByTestId("detail-pool").first()).toContainText("已成团");
    await expect(group.getByTestId("detail-pool").nth(1)).toContainText("确认开做 · 还剩 4 块");
  });

  test("checkout: the line's bar, the 没成团 choice, and the choice is sent with the 拼单 line only", async ({ page }) => {
    const posted: Record<string, unknown>[] = [];
    await mock(page, posted);
    await page.goto("/");
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [CART_KEY, JSON.stringify([{ productId: BASQUE.id, flavorId: PLAIN, qty: 2 }, { productId: BREAD.id, qty: 1 }])] as const,
    );
    await page.route("**/api/o/tok-group", (r) =>
      r.fulfill({
        json: {
          orderNo: "1117-001", status: "NEW", pickupDate: "2026-11-17", fulfillment: "PICKUP", subtotalCents: 1447, deliveryFeeCents: 0, totalCents: 1447,
          pickupNote: "", ownerWechatId: null, cancellable: false,
          items: [
            { name: "巴斯克蛋糕", flavorName: "经典原味", qty: 2, lineTotalCents: 1198, imageUrl: null, poolStatus: "OPEN", willBake: false },
            { name: "奶酥红豆包", qty: 1, lineTotalCents: 249, imageUrl: null },
          ],
        },
      }),
    );
    await page.goto("/checkout");
    const basque = page.locator(`[data-testid="cart-line"][data-product-id="${BASQUE.id}"]`);
    await page.locator('[data-testid="date-card"][data-date="2026-11-17"]').click();
    // 3 ordered + the 2 in this bag.
    await expect(basque.getByTestId("line-pool")).toContainText("加上你的就成团");
    const choice = page.getByTestId("group-choice");
    await expect(choice).toContainText("满 4 块开做；没成团时：");
    await expect(choice.getByTestId("group-if-contact")).toHaveAttribute("aria-checked", "true");
    await choice.getByTestId("group-if-cancel").click();
    await page.getByRole("textbox", { name: "微信号" }).fill("bunny_fan");
    await page.getByRole("button", { name: /确认提交预订/ }).click();
    await expect(page).toHaveURL(/\/o\/tok-group/);
    expect(posted).toHaveLength(1);
    expect(posted[0].items).toEqual([
      { productId: BASQUE.id, flavorId: PLAIN, qty: 2, ifNotFormed: "CANCEL" },
      { productId: BREAD.id, qty: 1 },
    ]);
    await expect(page.getByTestId("order-pool")).toHaveText("拼单中");
  });

  test("现货: the detail offers the lot, +1 adds its own line, capped at what is left, sent with stockLotId", async ({ page }) => {
    const posted: Record<string, unknown>[] = [];
    await mock(page, posted);
    await page.route("**/api/stock-lots", (r) =>
      r.fulfill({ json: { lots: [{ lotId: "lot-1", date: "2026-11-17", productId: BREAD.id, flavorId: null, left: 2, sellUntil: "2026-11-17T18:00:00Z" }] } }),
    );
    await page.goto("/");
    await page.locator(`[data-testid="product-card"][data-product-id="${BREAD.id}"]`).getByTestId("tile-photo").click();
    const offer = page.getByTestId("detail-stock");
    await expect(offer).toContainText("现货");
    await expect(offer).toContainText("剩 2 块");
    const add = offer.getByTestId("detail-stock-add");
    await add.click();
    await add.click();
    await expect(add).toBeDisabled();
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), CART_KEY);
    expect(stored).toEqual([{ productId: BREAD.id, qty: 2, stockLotId: "lot-1" }]);
    await page.goto("/checkout");
    await expect(page.locator(`[data-testid="cart-line"][data-product-id="${BREAD.id}"]`).getByTestId("line-stock")).toHaveText("现货");
    await expect(page.getByTestId("group-choice")).toHaveCount(0);
  });
});
