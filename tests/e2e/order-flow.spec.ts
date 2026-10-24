// J3: the order page of the continuous flow (bag before data, save-link reminder, top bar,
// layout rules) and the 404 pages. GET /api/o/{token} is mocked.
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";

const t = copy.customer.order;
const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const ORDER_PATH = `/o/${TOKEN}`;
const API_PATH = `/api/o/${TOKEN}`;
const PENDING_KEY = "bb_pending_save_v1";

type Order = Record<string, unknown>;

function makeOrder(overrides: Order = {}): Order {
  return {
    orderNo: "B-1042",
    items: [
      { name: "奶酥红豆包", qty: 2, lineTotalCents: 498, imageUrl: null },
      { name: "奶酪角", qty: 1, lineTotalCents: 299, imageUrl: null },
    ],
    subtotalCents: 797,
    deliveryFeeCents: 0,
    totalCents: 797,
    pickupDate: "2026-10-30",
    pickupDateLabel: "10/30 周五",
    fulfillment: "PICKUP",
    statusText: copy.customerStatus.pending.replace("{ownerWechatId}", "bunbunny_bakes"),
    statusKind: "PENDING",
    ownerWechatId: "bunbunny_bakes",
    pickupNote: null,
    canCancel: true,
    cancelDeadlineLabel: "10/29 周四 20:00 前可以自己取消",
    note: null,
    ...overrides,
  };
}

async function mockOrder(page: Page, current: () => Order | null) {
  await page.route(`**${API_PATH}`, (route) => {
    const order = current();
    if (!order) return route.fulfill({ status: 404, json: { error: "NOT_FOUND", message: copy.errors.NOT_FOUND } });
    return route.fulfill({ status: 200, json: order });
  });
}

const SAVED_BAG = {
  orderNo: "B-1042",
  items: [
    { name: "奶酥红豆包", imageUrl: "/brand/logo.webp", qty: 2 },
    { name: "奶酪角", imageUrl: "/brand/logo.webp", qty: 1 },
  ],
};

test.describe("?new=1 while the order loads", () => {
  test("the bag is drawn at once from the saved bread; the stamp starts when the data arrives", async ({ page }) => {
    await page.addInitScript((bag) => sessionStorage.setItem("bunbunny:lastBag", JSON.stringify(bag)), SAVED_BAG);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**${API_PATH}`, async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: makeOrder() });
    });
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByTestId("order-stage")).toBeVisible();
    await expect(page.locator(".pb-pi")).toHaveCount(3); // 2 + 1 breads, before any data
    await expect(page.getByText(t.loading)).toHaveCount(0); // no "loading" message
    await page.locator(".pb-pi").first().evaluate((el) => el.setAttribute("data-same", "1"));
    await page.waitForTimeout(1500); // the sequence waits for the order
    await expect(page.getByTestId("order-stamp")).toHaveCount(0);
    await expect(page.locator("[data-seq]")).toHaveAttribute("data-seq", "hide");

    release();
    await expect(page.locator("[data-seq]")).toHaveAttribute("data-seq", "show", { timeout: 4000 });
    await expect(page.getByTestId("order-stamp")).toContainText("B-1042");
    await expect(page.locator(".pb-pi")).toHaveCount(3);
    await expect(page.locator('.pb-pi[data-same="1"]')).toHaveCount(1); // the same bread, not rebuilt
  });

  test("without saved bread the neutral loading text shows instead", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**${API_PATH}`, async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: makeOrder() });
    });
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByText(t.loading)).toBeVisible();
    await expect(page.getByTestId("order-stage")).toHaveCount(0);
    await expect(page.getByTestId("top-bar")).toBeVisible();
    release();
    await expect(page.getByTestId("new-title")).toBeVisible();
  });
});

test.describe("save-link reminder (D89)", () => {
  test("opens ~1.3 s after the stamp, and again on every later visit until 我已保存", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    const column = page.locator("[data-seq]");
    await expect(column).toHaveAttribute("data-seq", "show", { timeout: 4000 });
    const stampedAt = Date.now();
    const modal = page.getByTestId("save-modal");
    await expect(modal).toBeVisible({ timeout: 4000 });
    expect(Date.now() - stampedAt).toBeGreaterThan(1000);
    expect(await page.evaluate((k) => localStorage.getItem(k), PENDING_KEY)).toContain(TOKEN);

    // Refreshing before saving: it comes back (no stamp this time, a moment after the page shows).
    await page.reload();
    await expect(page.getByTestId("status-text")).toBeVisible();
    await expect(page.locator("[data-seq]")).toHaveCount(0);
    await expect(page.getByTestId("save-modal")).toBeVisible({ timeout: 3000 });

    // 我已保存 ends it for good.
    await page.getByTestId("save-done").click();
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k) ?? "[]", PENDING_KEY)).not.toContain(TOKEN);
    await page.reload();
    await expect(page.getByTestId("status-text")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("an order that is not pending never shows it", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("save-modal")).toHaveCount(0);
  });

  test("a pending order from checkout (no ?new=1) shows it on the next visit", async ({ page }) => {
    await page.addInitScript(([k, token]) => localStorage.setItem(k, JSON.stringify([token])), [PENDING_KEY, TOKEN]);
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("save-modal")).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("save-modal")).toContainText(t.saveHint);
  });

  test("the dialog cannot be dismissed by Esc, the backdrop or a pull down", async ({ page }) => {
    await page.addInitScript(([k, token]) => localStorage.setItem(k, JSON.stringify([token])), [PENDING_KEY, TOKEN]);
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    const modal = page.getByTestId("save-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(900);
    await page.keyboard.press("Escape");
    await page.getByTestId("save-modal-backdrop").click({ position: { x: 4, y: 4 } });
    const box = (await modal.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 260, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(modal).toBeVisible();
  });
});

test.describe("layout of the order page", () => {
  test("status line, stage, spacing and top bar", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    const status = page.getByTestId("status-text");
    await expect(status).toBeVisible();
    const style = await status.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, weight: cs.fontWeight, line: cs.lineHeight, family: cs.fontFamily };
    });
    expect(style.size).toBe("17px");
    expect(style.weight).toBe("700");
    expect(style.line).toBe("25.5px");
    expect(style.family).not.toMatch(/display/i); // the system font, not the display face

    expect(Math.round((await page.getByTestId("order-stage").boundingBox())!.height)).toBe(320);
    const bar = page.getByTestId("top-bar");
    expect(Math.round((await bar.boundingBox())!.height)).toBe(56);
    await expect(page.getByTestId("top-bar-back")).toHaveAttribute("href", "/");

    // 24 / 16 / 24 / 8 between status, order card, link card, cancel and the link home.
    const gaps = await page.evaluate(() => {
      const rest = Array.from(document.querySelectorAll<HTMLElement>("[data-rest]"));
      const rects = rest.map((el) => el.getBoundingClientRect());
      const gap = (a: number, b: number) => Math.round(rects[b].top - rects[a].bottom);
      return { count: rest.length, statusToCard: gap(0, 1), cardToLink: gap(1, 2), linkToCancel: gap(2, 3), cancelToHome: gap(3, 4) };
    });
    expect(gaps).toEqual({ count: 5, statusToCard: 24, cardToLink: 16, linkToCancel: 24, cancelToHome: 8 });
  });

  test("the pay-on-receipt line is gone once the order is completed or cancelled (D93)", async ({ page }) => {
    let order = makeOrder();
    await mockOrder(page, () => order);
    await page.goto(ORDER_PATH);
    await expect(page.getByText(t.payOnReceipt)).toBeVisible();
    for (const [statusKind, statusText] of [
      ["COMPLETED", copy.customerStatus.completed],
      ["CANCELLED", copy.customerStatus.cancelled],
    ]) {
      order = makeOrder({ statusKind, statusText, canCancel: false });
      await page.reload();
      await expect(page.getByTestId("status-text")).toHaveText(statusText);
      await expect(page.getByText(t.payOnReceipt)).toHaveCount(0);
    }
    order = makeOrder({ statusKind: "CONFIRMED", statusText: copy.customerStatus.confirmed });
    await page.reload();
    await expect(page.getByText(t.payOnReceipt)).toBeVisible();
  });

  test("both 404 pages have the top bar, the real logo and one way home", async ({ page }) => {
    await mockOrder(page, () => null);
    for (const path of [ORDER_PATH, "/no-such-page"]) {
      await page.goto(path);
      await expect(page.getByText(copy.errors.NOT_FOUND)).toBeVisible();
      await expect(page.getByTestId("top-bar")).toBeVisible();
      await expect(page.getByRole("img", { name: "兔的大面包" })).toBeVisible();
      await expect(page.getByRole("link", { name: t.backHome })).toHaveCount(1);
    }
  });

  test("the cancel confirmation is the shared sheet: Esc closes it, focus returns", async ({ page }) => {
    await mockOrder(page, () => makeOrder({ statusKind: "CONFIRMED", statusText: copy.customerStatus.confirmed }));
    await page.goto(ORDER_PATH);
    await page.getByRole("button", { name: t.cancelOrder }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden"); // scroll lock
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    await expect(page.getByRole("button", { name: t.cancelOrder })).toBeFocused();
  });
});
