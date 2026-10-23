// H1 (D83, D84): save-link modal after ordering, "my orders" list, home entry. All APIs mocked.
import { expect, test, type Page, type Route } from "@playwright/test";
import { copy } from "../../src/copy";

const o = copy.customer.order;
const m = copy.customer.myOrders;
const KEY = "bb_orders_v1";
const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

type Order = Record<string, unknown>;

function makeOrder(overrides: Order = {}): Order {
  return {
    orderNo: "B-1042",
    items: [{ name: "奶酥红豆包", qty: 4, lineTotalCents: 899, imageUrl: null }],
    subtotalCents: 899,
    deliveryFeeCents: 0,
    totalCents: 899,
    pickupDate: "2026-10-30",
    pickupDateLabel: "10/30 周五",
    fulfillment: "PICKUP",
    statusText: copy.customerStatus.confirmed,
    statusKind: "CONFIRMED",
    ownerWechatId: "bunbunny_bakes",
    pickupNote: null,
    canCancel: true,
    cancelDeadlineLabel: "10/29 周四 20:00 前可以自己取消",
    note: null,
    ...overrides,
  };
}

/** GET /api/o/{token} from a per-token handler; unknown tokens are 404. */
async function mockOrders(page: Page, handlers: Record<string, (n: number) => Order | "404" | "abort">) {
  const calls: Record<string, number> = {};
  await page.route("**/api/o/*", async (route: Route) => {
    const token = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    calls[token] = (calls[token] ?? 0) + 1;
    const result = handlers[token]?.(calls[token]) ?? "404";
    if (result === "abort") return route.abort("failed");
    if (result === "404") return route.fulfill({ status: 404, json: { error: "NOT_FOUND", message: copy.errors.NOT_FOUND } });
    return route.fulfill({ status: 200, json: result });
  });
  return calls;
}

async function mockMenu(page: Page, ownerWechatId?: string) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled: true,
        products: [],
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 8,
        ...(ownerWechatId ? { ownerWechatId } : {}),
      },
    }),
  );
}

async function seedStorage(page: Page, entries: { token: string; orderNo: string; savedAt: number }[]) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("seeded", "1");
      }
    },
    [KEY, JSON.stringify(entries)] as const,
  );
}

/** A working clipboard stub that records what was written. */
async function stubClipboard(page: Page, mode: "ok" | "fail") {
  await page.addInitScript((failing) => {
    const w = window as unknown as { __copied: string | null };
    w.__copied = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (failing) throw new Error("denied");
          w.__copied = text;
        },
      },
    });
    if (failing) document.execCommand = () => false;
  }, mode === "fail");
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("save-link modal (D83)", () => {
  test("opens ~0.8 s after the stamp on ?new=1, traps focus, only 我已保存 closes it, copy works", async ({ page }) => {
    await stubClipboard(page, "ok");
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}?new=1`);

    const column = page.locator("[data-seq]");
    await expect(column).toHaveAttribute("data-seq", "hide");
    // Not before the stamp has landed.
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
    await expect(column).toHaveAttribute("data-seq", "show", { timeout: 3000 });
    const stampedAt = Date.now();
    const modal = page.getByTestId("save-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });
    expect(Date.now() - stampedAt).toBeGreaterThan(300);

    await expect(modal).toHaveAttribute("role", "dialog");
    await expect(modal).toHaveAttribute("aria-modal", "true");
    await expect(modal.getByRole("heading")).toHaveText(o.saveTitle);
    await expect(modal).toContainText(o.saveHint);
    const copyBtn = page.getByTestId("save-copy");
    await expect(copyBtn).toHaveText(o.saveCopy);
    await expect(copyBtn).toBeFocused();
    expect((await copyBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Neither Esc nor a click on the backdrop closes it.
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
    await page.getByTestId("save-modal-backdrop").click({ position: { x: 4, y: 4 } });
    await expect(modal).toBeVisible();

    // Focus never leaves the dialog.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="save-modal"]'))).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="save-modal"]'))).toBe(true);
    }

    await copyBtn.click();
    await expect(copyBtn).toHaveText(o.saveCopied);
    const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(copied).toBe(new URL(`/o/${TOKEN}`, page.url()).href);
    expect(copied).not.toContain("new=1");

    await page.getByTestId("save-done").click();
    await expect(modal).toHaveCount(0);
    // The save-link card stays on the page.
    await expect(page.getByTestId("order-link")).toBeVisible();

    // Not again on reload.
    await page.reload();
    await expect(page.getByTestId("status-text")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("a failed copy shows the link in a selectable field", async ({ page }) => {
    await stubClipboard(page, "fail");
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}?new=1`);
    await expect(page.getByTestId("save-modal")).toBeVisible({ timeout: 6000 });
    await page.getByTestId("save-copy").click();
    const fallback = page.getByTestId("save-link-fallback");
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText(o.saveCopyFailed);
    await expect(fallback.getByRole("textbox")).toHaveValue(new URL(`/o/${TOKEN}`, page.url()).href);
    await expect(page.getByTestId("save-copy")).toHaveText(o.saveCopy);
    await page.getByTestId("save-done").click();
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("a plain visit never shows it", async ({ page }) => {
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}`);
    await expect(page.getByTestId("status-text")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("reduced motion: it appears at once, without the stamp sequence", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}?new=1`);
    await expect(page.getByTestId("save-modal")).toBeVisible({ timeout: 800 });
    await expect(page.locator("[data-seq]")).toHaveCount(0);
    await expect(page.getByTestId("save-modal")).toHaveCSS("animation-name", "none");
    await page.getByTestId("save-done").click();
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("320 px: the dialog fits and the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}?new=1`);
    const modal = page.getByTestId("save-modal");
    await expect(modal).toBeVisible({ timeout: 6000 });
    const box = (await modal.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/h1-modal-320.png" });
  });
});

test.describe("order page records the order (D84)", () => {
  test("a successful load saves {token, orderNo, savedAt}; a 404 saves nothing", async ({ page }) => {
    await mockOrders(page, { [TOKEN]: () => makeOrder() });
    await page.goto(`/o/${TOKEN}`);
    await expect(page.getByTestId("status-text")).toBeVisible();
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ token: TOKEN, orderNo: "B-1042" });
    expect(typeof stored[0].savedAt).toBe("number");

    await page.goto("/o/not-a-real-token");
    await expect(page.getByText(copy.errors.NOT_FOUND).first()).toBeVisible();
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]").length, KEY)).toBe(1);
  });
});

test.describe("/orders (D84)", () => {
  const entries = [
    { token: "tokA", orderNo: "B-1001", savedAt: 4 },
    { token: "tokB", orderNo: "B-1002", savedAt: 3 },
    { token: "tokC", orderNo: "B-1003", savedAt: 2 },
    { token: "tokD", orderNo: "B-1004", savedAt: 1 },
  ];

  test("live statuses, 404 pruning, network error with retry, footer hint", async ({ page }) => {
    await mockMenu(page);
    await seedStorage(page, entries);
    const calls = await mockOrders(page, {
      tokA: () =>
        makeOrder({ orderNo: "B-1001", totalCents: 2099, statusText: copy.customerStatus.readyPickup, statusKind: "READY" }),
      tokB: () => "404",
      tokC: (n) => (n === 1 ? "abort" : makeOrder({ orderNo: "B-1003", totalCents: 1500, pickupDateLabel: "11/02 周一" })),
      tokD: () =>
        makeOrder({ orderNo: "B-1004", totalCents: 500, statusText: copy.customerStatus.completed, statusKind: "COMPLETED" }),
    });
    const res = await page.goto("/orders");
    expect(res?.headers()["referrer-policy"] ?? "").toBeDefined();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.pageTitle);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");

    const rows = page.getByTestId("order-row");
    // tokB (404) is pruned; the others stay in order, newest first.
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByTestId("row-order-no")).toHaveText("B-1001");
    await expect(rows.nth(0).getByTestId("row-total")).toHaveText("$20.99");
    await expect(rows.nth(0).getByTestId("row-date")).toHaveText("10/30 周五");
    await expect(rows.nth(0).getByTestId("row-status")).toHaveText(copy.customerStatus.readyPickup);
    await expect(rows.nth(0)).toHaveAttribute("data-state", "ready");
    await expect(rows.nth(0).locator("a")).toHaveAttribute("href", "/o/tokA");

    // Network error: order number and a retry button.
    await expect(rows.nth(1)).toHaveAttribute("data-state", "failed");
    await expect(rows.nth(1)).toContainText("B-1003");
    await expect(rows.nth(1)).toContainText(m.rowFailed);
    await expect(rows.nth(2).getByTestId("row-status")).toHaveText(copy.customerStatus.completed);

    // 404 is removed from storage too.
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), KEY);
    expect(stored.map((e: { token: string }) => e.token)).toEqual(["tokA", "tokC", "tokD"]);
    expect(calls.tokB).toBe(1);

    const retry = page.getByTestId("order-row-retry");
    expect(Math.round((await retry.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    await retry.click();
    await expect(rows.nth(1)).toHaveAttribute("data-state", "ready");
    await expect(rows.nth(1).getByTestId("row-total")).toHaveText("$15.00");
    await expect(page.getByTestId("order-row-retry")).toHaveCount(0);

    await expect(page.getByTestId("orders-hint")).toHaveText(m.footerHint);
    await page.screenshot({ path: "test-results/h1-orders.png", fullPage: true });

    // A row opens the order.
    await rows.nth(0).locator("a").click();
    await expect(page).toHaveURL(/\/o\/tokA$/);
  });

  test("the footer hint carries the owner's WeChat id when the menu returns it", async ({ page }) => {
    await mockMenu(page, "bunbunny_bakes");
    await seedStorage(page, [entries[0]]);
    await mockOrders(page, { tokA: () => makeOrder({ orderNo: "B-1001" }) });
    await page.goto("/orders");
    await expect(page.getByTestId("orders-hint")).toHaveText(m.footerHintWithId.replace("{id}", "bunbunny_bakes"));
  });

  test("empty state still shows the hint", async ({ page }) => {
    await mockMenu(page);
    await page.goto("/orders");
    await expect(page.getByTestId("orders-empty")).toHaveText(m.empty);
    await expect(page.getByTestId("orders-hint")).toHaveText(m.footerHint);
    await page.screenshot({ path: "test-results/h1-orders-empty.png", fullPage: true });
  });

  test("unreadable or garbage storage is an empty list, not a crash", async ({ page }) => {
    await mockMenu(page);
    await page.addInitScript((k) => localStorage.setItem(k, "{not json"), KEY);
    await page.goto("/orders");
    await expect(page.getByTestId("orders-empty")).toBeVisible();
  });

  test("320 px: 20 entries with long status text do not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockMenu(page, "bunbunny_bakes");
    const many = Array.from({ length: 20 }, (_, i) => ({ token: `t${i}`, orderNo: `B-${2000 + i}`, savedAt: 100 - i }));
    await seedStorage(page, many);
    const handlers: Record<string, () => Order> = {};
    for (const e of many) {
      handlers[e.token] = () =>
        makeOrder({
          orderNo: e.orderNo,
          totalCents: 123456,
          statusText: copy.customerStatus.pending.replace("{ownerWechatId}", "bunbunny_bakes_with_a_very_long_id"),
        });
    }
    await mockOrders(page, handlers);
    await page.goto("/orders");
    await expect(page.getByTestId("order-row")).toHaveCount(20);
    await expect(page.locator('[data-state="ready"]')).toHaveCount(20);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.screenshot({ path: "test-results/h1-orders-320.png" });
  });

  test("reduced motion: nothing depends on animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockMenu(page);
    await seedStorage(page, [entries[0]]);
    await mockOrders(page, { tokA: () => makeOrder({ orderNo: "B-1001" }) });
    await page.goto("/orders");
    await expect(page.getByTestId("order-row")).toHaveAttribute("data-state", "ready");
  });
});

test.describe("home entry (D84)", () => {
  test("the header always shows the 订单 entry and it opens /orders", async ({ page }) => {
    // Menu never answers: the entry is there anyway.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/menu", async (route) => {
      await gate;
      await route.fulfill({
        json: { orderingEnabled: true, products: [], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 },
      });
    });
    await page.goto("/");
    const link = page.getByTestId("my-orders-link");
    await expect(link).toBeVisible();
    await expect(link).toContainText(copy.customer.home.myOrdersEntry);
    await expect(link).toHaveAttribute("href", "/orders");
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: "test-results/h1-home.png" });
    release();
    await link.click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(m.pageTitle);
  });

  test("320 px: the header entry fits next to the logo", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.route("**/api/menu", (route) =>
      route.fulfill({
        json: { orderingEnabled: false, products: [], pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 },
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId("ordering-state")).toBeVisible();
    await expect(page.getByTestId("my-orders-link")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    const box = (await page.getByTestId("my-orders-link").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});
