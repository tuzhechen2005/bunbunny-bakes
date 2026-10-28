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

async function openHome(page: Page, { teasers = false } = {}) {
  await mockShop(page);
  // The orb's pop-up questions (D120) would turn a tap on the orb into a question; most tests want the
  // plain orb, so they switch the questions off with the hook in AssistantTeaser.
  if (!teasers) await page.addInitScript(() => ((window as unknown as { __noTeasers: boolean }).__noTeasers = true));
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
    // It grows in from a point (about 0.9 s); measure the full size.
    await expect.poll(async () => (await entry.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(78);
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

  test("a question bubble pops up beside the orb; a tap asks it, the sheet orb thinks while waiting", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let body: { messages: { role: string; content: string }[] } | null = null;
    await page.route("**/api/assistant", async (route) => {
      body = route.request().postDataJSON();
      await held;
      await route.fulfill({ json: { reply: "周四有奶酪角。", remaining: 19 } });
    });
    await openHome(page, { teasers: true });
    await scrollToList(page);
    const entry = page.getByTestId("assistant-entry");
    await expect(entry).toHaveAttribute("data-teasing", "1", { timeout: 6000 });
    await expect(page.getByTestId("assistant-teaser")).toHaveText("这周四能取什么？");
    // The orb shrinks to about half while a question shows.
    await expect.poll(async () => (await entry.boundingBox())?.height ?? 99).toBeLessThan(50);
    await expect(entry).toHaveAccessibleName("这周四能取什么？");
    await entry.click();
    await expect(page.getByRole("dialog", { name: "小小🐰" })).toBeVisible();
    await expect(page.getByTestId("assistant-sheet-orb")).toHaveAttribute("data-thinking", "1");
    await expect(page.getByTestId("assistant-typing")).toBeVisible();
    expect(body!.messages).toEqual([{ role: "user", content: "这周四能取什么？" }]);
    release();
    await expect(page.getByTestId("assistant-reply")).toContainText("周四有奶酪角");
    await expect(page.getByTestId("assistant-sheet-orb")).toHaveAttribute("data-thinking", "0");
    // Once the customer used it, no more questions this session.
    await page.getByTestId("assistant-close").click();
    await page.waitForTimeout(2500);
    await expect(entry).toHaveAttribute("data-teasing", "0");
  });

  test("questions rotate and keep coming after the orb was opened, just less often", async ({ page }) => {
    test.setTimeout(70_000);
    await page.route("**/api/assistant", (route) => route.fulfill({ json: { reply: "好的。", remaining: 19 } }));
    await openHome(page, { teasers: true });
    await scrollToList(page);
    const entry = page.getByTestId("assistant-entry");
    await expect(entry).toHaveAttribute("data-teasing", "1", { timeout: 6000 });
    await expect(entry).toHaveAttribute("data-teasing", "0", { timeout: 7000 });
    await expect(page.getByTestId("assistant-teaser")).toHaveText("泡芙怎么订？", { timeout: 7000 });
    await expect(entry).toHaveAttribute("data-teasing", "0", { timeout: 7000 });
    await entry.click();
    await page.getByTestId("assistant-close").click();
    // After use: no question within the fast 4 s gap, but one comes back within the slower 15 s one.
    await page.waitForTimeout(6000);
    await expect(entry).toHaveAttribute("data-teasing", "0");
    await expect(entry).toHaveAttribute("data-teasing", "1", { timeout: 20000 });
  });

  test("typing: compact header and the sheet pinned to the visible area; back to the big orb on blur", async ({ page }) => {
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    const orb = page.getByTestId("assistant-sheet-orb");
    await expect.poll(async () => (await orb.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    // Let the sheet finish opening (it moves focus to its close button), then tap the input like a person.
    await page.waitForTimeout(600);
    await page.getByTestId("assistant-input").click();
    await expect.poll(async () => (await orb.boundingBox())?.width ?? 0).toBeLessThan(50);
    const sheet = page.getByTestId("assistant-sheet");
    await expect.poll(() => sheet.evaluate((el) => (el as HTMLElement).style.top)).not.toBe("");
    await page.getByTestId("assistant-input").blur();
    await expect.poll(async () => (await orb.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await expect.poll(() => sheet.evaluate((el) => (el as HTMLElement).style.top)).toBe("");
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

  test("500 unbroken characters stay inside their bubbles", async ({ page }) => {
    const long = "x".repeat(500);
    await page.route("**/api/assistant", (route) =>
      route.fulfill({ json: { reply: long, suggestion: { items: [{ productId: "nj", qty: 1 }], date: null, note: long }, remaining: 5 } }),
    );
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByTestId("assistant-input").fill(long);
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-suggestion")).toBeVisible();
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="assistant-sheet"] p')].filter((p) => p.scrollWidth > p.clientWidth).length,
    );
    expect(overflowing).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("a suggestion drops unknown items, merges duplicates and clamps to the per-item limit", async ({ page }) => {
    await page.route("**/api/assistant", (route) =>
      route.fulfill({
        json: {
          reply: "好",
          suggestion: { items: [{ productId: "nj", qty: 15 }, { productId: "zzz", qty: 2 }, { productId: "nj", qty: 15 }, { productId: "hd", qty: 1 }], date: null, note: "" },
          remaining: 5,
        },
      }),
    );
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await page.getByTestId("assistant-apply").click();
    await expect(page.getByTestId("assistant-sheet")).toHaveCount(0);
    const cart = await page.evaluate(([k]) => localStorage.getItem(k), [CART_KEY]);
    expect(JSON.parse(cart!)).toEqual([{ productId: "nj", qty: 20 }, { productId: "hd", qty: 1 }]);
  });

  test("no answer within 12 s shows the 暂时不在 line", async ({ page }) => {
    await page.clock.install();
    await page.route("**/api/assistant", () => {
      // held: never answered
    });
    await openHome(page);
    await scrollToList(page);
    await page.getByTestId("assistant-entry").click();
    await page.getByRole("button", { name: "周四能取什么" }).click();
    await expect(page.getByTestId("assistant-typing")).toBeVisible();
    await page.clock.fastForward(13000);
    await expect(page.getByTestId("assistant-error")).toHaveText("小小🐰 暂时不在，可以直接下单哦");
    await expect(page.getByTestId("assistant-typing")).toHaveCount(0);
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
