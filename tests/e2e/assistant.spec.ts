// 小小🐰 assistant UI against a mocked /api/assistant (contract C3), /api/menu and /api/availability.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const CART_KEY = "bb_cart_v1";
const DATE_KEY = "bb_cart_date_v1";
const SHOTS = process.env.N4_SHOTS ?? "";

const PRODUCTS = [
  ["hd", "奶酥红豆包", 249, 899],
  ["rs", "岩烧乳酪包", 249, 899],
  ["nj", "奶酪角", 299, 1099],
  ["bl", "焦糖布蕾", 249, 899],
  ["pf", "泡芙", 350, 1200],
].map(([id, name, unit, bundle]) => ({
  id,
  name,
  description: null,
  imageUrl: null,
  unitPriceCents: unit,
  bundleSize: 4,
  bundlePriceCents: bundle,
  status: "ACTIVE",
  leadDays: 1,
  pickupWeekdays: [],
}));

async function mockShop(page: Page) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: { orderingEnabled: true, products: PRODUCTS, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 20 },
    }),
  );
  await page.route("**/api/availability", async (route) => {
    const body = route.request().postDataJSON() as { items: { productId: string; qty: number }[] };
    const subtotal = body.items.reduce((s, i) => s + i.qty * 300, 0);
    await route.fulfill({
      json: {
        orderingEnabled: true,
        pricing: { subtotalCents: subtotal, deliveryFeeCents: 0, totalCents: subtotal, freeDeliveryGapCents: 0 },
        cartProblems: [],
        dates: [
          { date: "2026-10-30", state: "AVAILABLE", cutoffAt: "2026-10-30T01:00:00Z", cutoffLabel: "10/29 周四 20:00 截止" },
          { date: "2026-11-05", state: "AVAILABLE", cutoffAt: "2026-11-05T01:00:00Z", cutoffLabel: "11/4 周三 20:00 截止" },
        ],
      },
    });
  });
}

const SUGGESTION = {
  reply: "给你配好啦，周四取。",
  suggestion: { items: [{ productId: "nj", qty: 2 }, { productId: "hd", qty: 1 }], date: "2026-11-05", note: "奶酪角要提前一天订" },
  remaining: 18,
};

async function openHome(page: Page) {
  await mockShop(page);
  await page.goto("/");
  await expect(page.getByTestId("rack")).toBeVisible();
}

async function scrollToList(page: Page) {
  await page.locator("#hm-list").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById("hm-list")!.scrollIntoView());
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `n4_assistant_ui-${name}.png`) });
}

test.describe("assistant", () => {
  test("hidden on the hero, shown over 全部面包, never covers the bag bar", async ({ page }) => {
    await openHome(page);
    const entry = page.getByTestId("assistant-entry");
    await expect(entry).toBeHidden();
    await scrollToList(page);
    await expect(entry).toBeVisible();
    const e = (await entry.boundingBox())!;
    const bag = (await page.getByTestId("bag-pill").boundingBox())!;
    expect(e.y + e.height).toBeLessThanOrEqual(bag.y);
    expect(e.width).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(400);
    await shot(page, "entry");
    await page.evaluate(() => document.querySelector('[data-testid="hero"]')!.scrollIntoView());
    await expect(entry).toBeHidden();
  });

  test("hidden on the game and order pages", async ({ page }) => {
    await mockShop(page);
    await page.goto("/game");
    await expect(page.getByTestId("assistant-entry")).toHaveCount(0);
    await page.goto("/orders");
    await expect(page.getByTestId("assistant-entry")).toHaveCount(0);
  });

  test("open, chips, send, close", async ({ page }) => {
    let body: { messages: { role: string; content: string }[]; cart: unknown[] } | null = null;
    await page.route("**/api/assistant", async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ json: { reply: "周四有奶酪角和红豆包。", remaining: 19 } });
    });
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await expect(page.getByRole("dialog", { name: "小小🐰" })).toBeVisible();
    await expect(page.getByTestId("assistant-opener")).toHaveText("想要什么面包、哪天取？跟我说就行");
    await expect(page.getByTestId("assistant-chips").getByRole("button")).toHaveText(["周四能取什么", "泡芙怎么订", "可以配送吗"]);
    await shot(page, "sheet");
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await expect(page.getByTestId("assistant-reply")).toContainText("周四有奶酪角");
    expect(body!.messages).toEqual([{ role: "user", content: "周四能取什么" }]);
    await page.getByTestId("assistant-input").fill("可以配送吗");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-reply")).toHaveCount(2);
    expect(body!.messages).toHaveLength(3);
    await page.getByTestId("assistant-close").click();
    await expect(page.getByTestId("assistant-sheet")).toHaveCount(0);
    // The conversation survives closing.
    await page.getByTestId("assistant-entry").click();
    await expect(page.getByTestId("assistant-reply")).toHaveCount(2);
  });

  test("suggestion replaces the bag (after asking) and sets the preferred date", async ({ page }) => {
    await page.route("**/api/assistant", (route) => route.fulfill({ json: SUGGESTION }));
    await openHome(page);
    await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify([{ productId: "bl", qty: 3 }])), [CART_KEY]);
    await page.reload();
    await expect(page.getByTestId("bag-badge")).toHaveText("3");
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "泡芙怎么订" }).click();
    const card = page.getByTestId("assistant-suggestion");
    await expect(card).toContainText("奶酪角 ×2");
    await expect(card).toContainText("取货 11/5 周四");
    await expect(card).toContainText("奶酪角要提前一天订");
    await shot(page, "suggestion");
    await page.getByTestId("assistant-apply").click();
    await expect(page.getByText("替换纸袋里的面包？")).toBeVisible();
    await page.getByTestId("assistant-replace-yes").click();
    await expect(page.getByTestId("assistant-sheet")).toHaveCount(0);
    const stored = await page.evaluate(([c, d]) => ({ cart: localStorage.getItem(c), date: localStorage.getItem(d) }), [CART_KEY, DATE_KEY]);
    expect(JSON.parse(stored.cart!)).toEqual([{ productId: "nj", qty: 2 }, { productId: "hd", qty: 1 }]);
    expect(stored.date).toBe("2026-11-05");
    await expect(page.getByTestId("bag-badge")).toHaveText("3");
  });

  test("empty bag: applies at once; checkout preselects the date", async ({ page }) => {
    await page.route("**/api/assistant", (route) => route.fulfill({ json: SUGGESTION }));
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "可以配送吗" }).click();
    await page.getByTestId("assistant-apply").click();
    await expect(page.getByTestId("assistant-sheet")).toHaveCount(0);
    await page.getByTestId("bag-pill").click();
    await page.getByTestId("bag-checkout").click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByTestId("date-card").nth(1)).toHaveAttribute("aria-pressed", "true");
  });

  test("429 and 503 show the owner's lines; 429 locks the input", async ({ page }) => {
    let status = 429;
    await page.route("**/api/assistant", (route) =>
      route.fulfill({ status, json: { error: status === 429 ? "ASSISTANT_LIMIT" : "ASSISTANT_UNAVAILABLE" } }),
    );
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await expect(page.getByTestId("assistant-error")).toHaveText("今天问太多啦，可以直接用下面的按钮下单");
    await expect(page.getByTestId("assistant-input")).toBeDisabled();
    await shot(page, "limit");
    await page.getByTestId("assistant-close").click();
    await page.reload();
    status = 503;
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await expect(page.getByTestId("assistant-error")).toHaveText("小小🐰 暂时不在，可以直接下单哦");
    await expect(page.getByTestId("assistant-input")).toBeEnabled();
  });

  test("403 and a dropped connection use the 暂时不在 line", async ({ page }) => {
    let mode: "403" | "abort" = "403";
    await page.route("**/api/assistant", (route) =>
      mode === "403" ? route.fulfill({ status: 403, json: { error: "FORBIDDEN_ORIGIN" } }) : route.abort(),
    );
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await expect(page.getByTestId("assistant-error")).toHaveText("小小🐰 暂时不在，可以直接下单哦");
    mode = "abort";
    await page.getByTestId("assistant-input").fill("你好");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-error")).toHaveCount(2);
  });

  test("checkout: entry shows, hides over the submit button; 320 px has no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockShop(page);
    await page.goto("/");
    await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify([{ productId: "hd", qty: 1 }])), [CART_KEY]);
    await page.goto("/checkout");
    const entry = page.getByTestId("assistant-entry");
    await expect(entry).toBeVisible();
    await page.getByTestId("submit").scrollIntoViewIfNeeded();
    await expect(entry).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.getByTestId("assistant-sheet")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await page.getByTestId("assistant-sheet").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });

  test("reduced motion: sheet still works", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/assistant", (route) => route.fulfill({ json: SUGGESTION }));
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await page.getByTestId("assistant-apply").click();
    await expect(page.getByTestId("assistant-sheet")).toHaveCount(0);
  });
});
