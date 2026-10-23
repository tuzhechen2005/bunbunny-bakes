import { expect, test, type Page, type Route } from "@playwright/test";
import { copy } from "../../src/copy";

const t = copy.customer.order;
const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const ORDER_PATH = `/o/${TOKEN}`;
const API_PATH = `/api/o/${TOKEN}`;

type Order = Record<string, unknown>;

function makeOrder(overrides: Order = {}): Order {
  return {
    orderNo: "B-1042",
    items: [
      { name: "奶酥红豆包", qty: 4, lineTotalCents: 899, imageUrl: null },
      { name: "奶酪角", qty: 2, lineTotalCents: 1200, imageUrl: null },
    ],
    subtotalCents: 2099,
    deliveryFeeCents: 0,
    totalCents: 2099,
    pickupDate: "2026-10-30",
    pickupDateLabel: "10/30 周五",
    fulfillment: "PICKUP",
    statusText: copy.customerStatus.pending.replace("{ownerWechatId}", "bunbunny_bakes"),
    statusKind: "PENDING",
    ownerWechatId: "bunbunny_bakes",
    pickupNote: "自提时间在下午 5 点以后，具体时间微信确认",
    canCancel: true,
    cancelDeadlineLabel: "10/29 周四 20:00 前可以自己取消",
    note: "少糖，谢谢",
    wechatId: "customer_wx",
    ...overrides,
  };
}

const CONFIRMED = { statusKind: "CONFIRMED", statusText: copy.customerStatus.confirmed };
const CANCELLED = { statusKind: "CANCELLED", statusText: copy.customerStatus.cancelled, canCancel: false };

/** Serves GET /api/o/{token} from `current()` and counts calls. Any other /api/o/* path is 404. */
async function mockOrder(page: Page, current: () => Order | null) {
  const calls = { get: 0, cancel: [] as { body: string | null; contentType: string | undefined }[] };
  await page.route("**/api/o/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "GET" && path === API_PATH) {
      calls.get++;
      const order = current();
      if (!order) {
        return route.fulfill({ status: 404, json: { error: "NOT_FOUND", message: copy.errors.NOT_FOUND } });
      }
      return route.fulfill({ status: 200, json: order });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND", message: copy.errors.NOT_FOUND } });
  });
  return calls;
}

/** Records every request; the test asserts nothing left this origin and no other API was hit. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

function expectOnlyOwnRequests(urls: string[], baseURL: string) {
  const origin = new URL(baseURL).origin;
  const wsOrigin = origin.replace(/^http/, "ws");
  for (const url of urls) {
    if (url.startsWith("data:") || url.startsWith("blob:")) continue;
    const u = new URL(url);
    expect([origin, wsOrigin], `external request: ${url}`).toContain(u.origin);
    if (u.pathname.startsWith("/api/")) expect(u.pathname, `unexpected API: ${url}`).toMatch(/^\/api\/o\//);
  }
}

test.describe("order page /o/{token}", () => {
  test("?new=1 shows the success banner, drops the query, and is gone after refresh", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    const banner = page.getByTestId("new-banner");
    await expect(page.getByTestId("new-title")).toHaveText(t.newTitle);
    await expect(banner).toContainText(t.newHint);
    // The banner shows the plain order link (no ?new=1).
    await expect(banner.getByRole("textbox")).toHaveValue(new URL(ORDER_PATH, page.url()).href);
    await expect(page).toHaveURL((url) => url.pathname === ORDER_PATH && url.search === "");
    // Still shown after the query is dropped (no remount / flash).
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("status-text")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("status-text")).toBeVisible();
    await expect(page.getByTestId("new-banner")).toHaveCount(0);
  });

  test("?new=1 folds the bag and stamps it, once; a plain visit shows it already stamped", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    const column = page.locator("[data-seq]");
    await expect(column).toHaveAttribute("data-seq", "hide");
    await expect(page.locator(".ord-stamper")).toHaveCount(1);
    // After the impact (about 1.25 s) the title and cards rise and the stamper is gone.
    await expect(column).toHaveAttribute("data-seq", "show", { timeout: 3000 });
    await expect(page.getByTestId("new-title")).toHaveText(t.newTitle);
    await expect(page.getByText(copy.customer.brand.receiptLast)).toBeVisible();
    await expect(page.getByTestId("order-stamp")).toContainText(t.stamp);
    await expect(page.getByTestId("order-stamp")).toContainText("B-1042");
    await expect(page.getByTestId("order-stamp")).toHaveCSS("opacity", "0.95", { timeout: 3000 });
    await expect(page.locator(".ord-stamper")).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByTestId("total")).toHaveCSS("opacity", "1", { timeout: 3000 });

    await page.reload();
    await expect(page.getByTestId("status-text")).toBeVisible();
    await expect(page.locator("[data-seq]")).toHaveCount(0);
    await expect(page.locator(".ord-stamper")).toHaveCount(0);
    await expect(page.getByTestId("new-title")).toHaveCount(0);
    await expect(page.getByTestId("order-stamp")).toHaveCSS("opacity", "0.92");
    await expect(page.getByTestId("total")).toHaveText("$20.99");
  });

  test("reduced motion shows the folded, stamped bag and the cards instantly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByTestId("new-title")).toBeVisible();
    await expect(page.locator("[data-seq]")).toHaveCount(0);
    await expect(page.locator(".ord-stamper")).toHaveCount(0);
    await expect(page.getByTestId("order-stamp")).toHaveCSS("opacity", "0.92");
    await expect(page.getByTestId("new-title")).toHaveCSS("opacity", "1");
    await expect(page.getByText(copy.customer.brand.receiptLast)).toBeVisible();
  });

  test("a cancelled order's bag carries no stamp", async ({ page }) => {
    await mockOrder(page, () => makeOrder(CANCELLED));
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.cancelled);
    await expect(page.getByTestId("paper-bag")).toBeVisible();
    await expect(page.getByTestId("order-stamp")).toHaveCount(0);
  });

  test("the bag shows the ordered bread: product photos, else the bread saved at checkout, else plain discs", async ({ page }) => {
    const photo = (name: string) => ({ name, qty: 2, lineTotalCents: 600, imageUrl: "/brand/logo.webp" });
    await mockOrder(page, () => makeOrder({ items: [photo("奶酥红豆包"), photo("奶酪角")] }));
    await page.goto(ORDER_PATH);
    const discs = page.locator(".pb-pi");
    await expect(discs).toHaveCount(4);
    await expect(page.locator(".pb-pi.pb-ph")).toHaveCount(0);
    await expect(discs.first()).toHaveCSS("background-image", /logo\.webp/);

    // No photo in the order: plain discs ...
    await page.unroute("**/api/o/**");
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.locator(".pb-pi")).toHaveCount(6);
    await expect(page.locator(".pb-pi.pb-ph")).toHaveCount(6);

    // ... unless checkout saved this order's bread in sessionStorage.
    await page.evaluate(() =>
      sessionStorage.setItem(
        "bunbunny:lastBag",
        JSON.stringify({
          orderNo: "B-1042",
          items: [
            { name: "奶酥红豆包", imageUrl: "/brand/logo.webp", qty: 4 },
            { name: "奶酪角", imageUrl: "/brand/logo.webp", qty: 2 },
          ],
        }),
      ),
    );
    await page.reload();
    await expect(page.locator(".pb-pi")).toHaveCount(6);
    await expect(page.locator(".pb-pi.pb-ph")).toHaveCount(0);
  });

  const statuses: [string, string][] = [
    ["PENDING", copy.customerStatus.pending.replace("{ownerWechatId}", "bunbunny_bakes")],
    ["CONFIRMED", copy.customerStatus.confirmed],
    ["BAKING", "正在烤制中"],
    ["READY", copy.customerStatus.readyPickup],
    ["COMPLETED", copy.customerStatus.completed],
    ["CANCELLED", copy.customerStatus.cancelled],
  ];
  for (const [statusKind, statusText] of statuses) {
    test(`renders status ${statusKind}`, async ({ page }) => {
      const finished = statusKind === "COMPLETED" || statusKind === "CANCELLED";
      await mockOrder(page, () => makeOrder({ statusKind, statusText, canCancel: !finished }));
      await page.goto(ORDER_PATH);
      await expect(page.getByTestId("status-text")).toHaveText(statusText);
      await expect(page.getByTestId("owner-wechat")).toHaveAttribute(
        "data-prominent",
        statusKind === "PENDING" ? "true" : "false",
      );
    });
  }

  test("shows order details, money as dollars, pay-on-receipt note", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("order-no")).toHaveText("B-1042");
    await expect(page.getByTestId("order-no")).toHaveAttribute("aria-label", "订单号：B-1042");
    await expect(page.getByText("10/30 周五")).toBeVisible();
    await expect(page.getByText(t.pickup, { exact: true })).toBeVisible();
    await expect(page.getByText("自提时间在下午 5 点以后，具体时间微信确认")).toBeVisible();
    await expect(page.getByText("奶酥红豆包 × 4")).toBeVisible();
    await expect(page.getByText("$8.99")).toBeVisible();
    // Pickup has no fee row.
    await expect(page.getByText(t.deliveryFee)).toHaveCount(0);
    await expect(page.getByTestId("total")).toHaveText("$20.99");
    await expect(page.getByText("备注：少糖，谢谢")).toBeVisible();
    await expect(page.getByText(t.payOnReceipt)).toBeVisible();
  });

  test("delivery: shows 配送 and hides the pickup note", async ({ page }) => {
    await mockOrder(page, () => makeOrder({ fulfillment: "DELIVERY", deliveryFeeCents: 500, totalCents: 2599 }));
    await page.goto(ORDER_PATH);
    await expect(page.getByText(t.delivery, { exact: true })).toBeVisible();
    await expect(page.getByText("自提时间在下午 5 点以后")).toHaveCount(0);
    await expect(page.getByText(t.deliveryFee)).toBeVisible();
    await expect(page.getByText("$5.00")).toBeVisible();
    await expect(page.getByTestId("total")).toHaveText("$25.99");
  });

  test("copy WeChat button shows 已复制", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void w.__copied.push(text) },
      });
    });
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    const block = page.getByTestId("owner-wechat");
    await expect(block).toContainText("店主微信 bunbunny_bakes");
    await block.getByRole("button", { name: t.copyWechat }).click();
    await expect(block.getByRole("button", { name: t.copied })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([
      "bunbunny_bakes",
    ]);
  });

  test("banner copy-link button (async clipboard) copies the link without ?new=1 and shows 已复制", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void w.__copied.push(text) },
      });
    });
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    const banner = page.getByTestId("new-banner");
    await expect(banner.getByRole("textbox")).toHaveAttribute("readonly", "");
    await banner.getByRole("button", { name: t.copyLink }).click();
    await expect(banner.getByRole("button", { name: t.copied })).toBeVisible();
    const link = new URL(ORDER_PATH, page.url()).href;
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([link]);
    expect(link).not.toContain("new=1");
  });

  test("banner copy-link button falls back to execCommand without navigator.clipboard", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __selected: string[] };
      w.__selected = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.execCommand = (command: string) => {
        const el = document.activeElement;
        if (command === "copy" && el instanceof HTMLInputElement) w.__selected.push(el.value);
        return true;
      };
    });
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    const banner = page.getByTestId("new-banner");
    await banner.getByRole("button", { name: t.copyLink }).click();
    await expect(banner.getByRole("button", { name: t.copied })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __selected: string[] }).__selected)).toEqual([
      new URL(ORDER_PATH, page.url()).href,
    ]);
  });

  test("without ?new=1 there is no banner but a secondary copy-link button", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void w.__copied.push(text) },
      });
    });
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toBeVisible();
    await expect(page.getByTestId("new-banner")).toHaveCount(0);
    const button = page.getByTestId("copy-link-secondary");
    await expect(button).toHaveText(t.copyLink);
    await button.click();
    await expect(button).toHaveText(t.copied);
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([
      new URL(ORDER_PATH, page.url()).href,
    ]);
  });

  test("hides the WeChat block when ownerWechatId is empty", async ({ page }) => {
    await mockOrder(page, () => makeOrder({ ownerWechatId: "" }));
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toBeVisible();
    await expect(page.getByTestId("owner-wechat")).toHaveCount(0);
  });

  test("cancel flow: confirm sheet, one POST, re-fetch, 已取消", async ({ page }) => {
    let order = makeOrder(CONFIRMED);
    const calls = await mockOrder(page, () => order);
    await page.route(`**${API_PATH}/cancel`, async (route) => {
      const req = route.request();
      calls.cancel.push({ body: req.postData(), contentType: req.headers()["content-type"] });
      order = makeOrder(CANCELLED);
      await route.fulfill({ status: 200, json: { status: "CANCELLED" } });
    });

    await page.goto(ORDER_PATH);
    await expect(page.getByText("10/29 周四 20:00 前可以自己取消")).toBeVisible();
    await page.getByRole("button", { name: t.cancelOrder }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(t.cancelConfirmTitle);
    // Focus moves into the sheet, onto the safe "back" button.
    await expect(sheet.getByRole("button", { name: t.cancelBack })).toBeFocused();
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // "back" closes without posting and returns focus to the trigger
    await sheet.getByRole("button", { name: t.cancelBack }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.cancelOrder })).toBeFocused();
    expect(calls.cancel).toHaveLength(0);

    // Escape also closes it
    await page.getByRole("button", { name: t.cancelOrder }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.cancelOrder })).toBeFocused();
    expect(calls.cancel).toHaveLength(0);

    await page.getByRole("button", { name: t.cancelOrder }).click();
    // Dev-mode StrictMode may fetch twice on mount, so count GETs from here.
    const getsBefore = calls.get;
    await page.getByRole("dialog").getByRole("button", { name: t.cancelConfirm }).click();

    await expect(page.getByText(t.cancelled, { exact: true })).toBeVisible();
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.cancelled);
    expect(calls.cancel).toEqual([{ body: "{}", contentType: "application/json" }]);
    expect(calls.get).toBe(getsBefore + 1);
    await expect(page.getByRole("button", { name: t.cancelOrder })).toHaveCount(0);
    await expect(page.getByText(t.cancelClosed)).toHaveCount(0);
  });

  test("cancel refused with 409 CUTOFF_PASSED shows its message", async ({ page }) => {
    let order = makeOrder(CONFIRMED);
    await mockOrder(page, () => order);
    await page.route(`**${API_PATH}/cancel`, async (route) => {
      order = makeOrder({ ...CONFIRMED, canCancel: false, cancelDeadlineLabel: null });
      await route.fulfill({
        status: 409,
        json: { error: "CUTOFF_PASSED", message: "已过取消时间，请微信联系店主" },
      });
    });
    await page.goto(ORDER_PATH);
    await page.getByRole("button", { name: t.cancelOrder }).click();
    await page.getByRole("dialog").getByRole("button", { name: t.cancelConfirm }).click();
    // The re-fetch says canCancel=false, so only the closed message shows (no duplicated alert).
    await expect(page.getByText(t.cancelClosed)).toBeVisible();
    await expect(page.getByRole("button", { name: t.cancelOrder })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("已过取消时间，请微信联系店主")).toHaveCount(0);
  });

  test("cancel 409 while the order still says cancellable shows the API message", async ({ page }) => {
    await mockOrder(page, () => makeOrder(CONFIRMED));
    await page.route(`**${API_PATH}/cancel`, (route) =>
      route.fulfill({ status: 409, json: { error: "NOT_CANCELLABLE", message: "这个订单现在不能取消了" } }),
    );
    await page.goto(ORDER_PATH);
    await page.getByRole("button", { name: t.cancelOrder }).click();
    await page.getByRole("dialog").getByRole("button", { name: t.cancelConfirm }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("这个订单现在不能取消了");
  });

  test("cancel 409 CUTOFF_PASSED without a message falls back to order-page copy", async ({ page }) => {
    await mockOrder(page, () => makeOrder(CONFIRMED));
    await page.route(`**${API_PATH}/cancel`, (route) =>
      route.fulfill({ status: 409, json: { error: "CUTOFF_PASSED" } }),
    );
    await page.goto(ORDER_PATH);
    await page.getByRole("button", { name: t.cancelOrder }).click();
    await page.getByRole("dialog").getByRole("button", { name: t.cancelConfirm }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(t.cancelClosed);
    await expect(page.getByText(copy.errors.CUTOFF_PASSED)).toHaveCount(0);
  });

  test("cancel succeeds but the re-fetch fails: shows retry, not the stale order", async ({ page }) => {
    let order: Order = makeOrder(CONFIRMED);
    let failGet = false;
    await page.route(`**${API_PATH}`, (route) =>
      failGet ? route.abort("failed") : route.fulfill({ status: 200, json: order }),
    );
    await page.route(`**${API_PATH}/cancel`, async (route) => {
      order = makeOrder(CANCELLED);
      failGet = true;
      await route.fulfill({ status: 200, json: { status: "CANCELLED" } });
    });
    await page.goto(ORDER_PATH);
    await page.getByRole("button", { name: t.cancelOrder }).click();
    await page.getByRole("dialog").getByRole("button", { name: t.cancelConfirm }).click();
    await expect(page.getByText(t.loadFailed)).toBeVisible();
    await expect(page.getByTestId("status-text")).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.cancelOrder })).toHaveCount(0);

    failGet = false;
    await page.getByRole("button", { name: t.retry }).click();
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.cancelled);
  });

  test("not cancellable and not finished: shows the contact-owner message", async ({ page }) => {
    await mockOrder(page, () => makeOrder({ ...CONFIRMED, canCancel: false, cancelDeadlineLabel: null }));
    await page.goto(ORDER_PATH);
    await expect(page.getByText(t.cancelClosed)).toBeVisible();
    await expect(page.getByRole("button", { name: t.cancelOrder })).toHaveCount(0);
  });

  test("completed order: no cancel button and no cancel message", async ({ page }) => {
    await mockOrder(page, () =>
      makeOrder({ statusKind: "COMPLETED", statusText: copy.customerStatus.completed, canCancel: false }),
    );
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.completed);
    await expect(page.getByText(t.cancelClosed)).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.cancelOrder })).toHaveCount(0);
  });

  test("API 404 renders the not-found copy without an order layout", async ({ page }) => {
    await mockOrder(page, () => null);
    await page.goto(ORDER_PATH);
    await expect(page.getByText(copy.errors.NOT_FOUND)).toBeVisible();
    await expect(page.getByRole("link", { name: t.backHome })).toHaveAttribute("href", "/");
    await expect(page.getByTestId("status-text")).toHaveCount(0);
  });

  test("global 404 page uses the same copy", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByText(copy.errors.NOT_FOUND)).toBeVisible();
    await expect(page.getByRole("link", { name: t.backHome })).toBeVisible();
  });

  const darkCases: [string, string, boolean][] = [
    ["global 404", "/o/", false],
    ["order page", ORDER_PATH, false],
    ["order 404", ORDER_PATH, true],
  ];
  for (const [name, path, notFound] of darkCases) {
    test(`${name} stays light and readable when the OS is in dark mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await mockOrder(page, () => (notFound ? null : makeOrder()));
      await page.goto(path);
      const target =
        name === "order page" ? page.getByTestId("status-text") : page.getByText(copy.errors.NOT_FOUND);
      await expect(target).toBeVisible();
      const colors = await target.evaluate((el) => {
        let node: Element | null = el;
        let bg = "rgba(0, 0, 0, 0)";
        while (node) {
          bg = getComputedStyle(node).backgroundColor;
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
          node = node.parentElement;
        }
        // Normalise any CSS colour (lab/oklch/rgb) to RGB via a canvas pixel.
        const lightness = (c: string) => {
          const ctx = document.createElement("canvas").getContext("2d")!;
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return (r + g + b) / 3;
        };
        return { text: lightness(getComputedStyle(el).color), bg: lightness(bg) };
      });
      expect(colors.bg).toBeGreaterThan(200); // light background
      expect(colors.text).toBeLessThan(140); // dark text
    });
  }

  test("network error shows retry, which recovers", async ({ page }) => {
    let fail = true;
    await page.route(`**${API_PATH}`, async (route) => {
      if (fail) return route.abort("failed");
      return route.fulfill({ status: 200, json: makeOrder(CONFIRMED) });
    });
    await page.goto(ORDER_PATH);
    await expect(page.getByText(t.loadFailed)).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: t.retry }).click();
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.confirmed);
  });

  test("noindex robots meta and no-referrer meta are present", async ({ page }) => {
    await mockOrder(page, () => makeOrder());
    await page.goto(ORDER_PATH);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });

  test("makes no external requests and no API calls besides /api/o/*", async ({ page, baseURL }) => {
    const urls = trackRequests(page);
    await mockOrder(page, () => makeOrder());
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByTestId("status-text")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(urls.some((u) => new URL(u).pathname === API_PATH)).toBe(true);
    expectOnlyOwnRequests(urls, baseURL!);
  });

  test("no horizontal scroll at 320px and touch targets are at least 44px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockOrder(page, () =>
      makeOrder({
        ...CONFIRMED,
        ownerWechatId: "a_really_long_wechat_id_without_spaces_123456",
        note: "很长的备注".repeat(20),
      }),
    );
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByTestId("status-text")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of await page.getByRole("main").getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  // Screenshots for review: only when SCREENSHOT_DIR is set.
  test("screenshots at 375px", async ({ page }) => {
    const dir = process.env.SCREENSHOT_DIR;
    test.skip(!dir, "SCREENSHOT_DIR not set");
    await page.setViewportSize({ width: 375, height: 812 });
    // Hide the Next.js dev-tools badge so it doesn't cover the page.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.appendChild(style);
      });
    });

    let order = makeOrder();
    await mockOrder(page, () => order);
    await page.goto(`${ORDER_PATH}?new=1`);
    await expect(page.getByTestId("new-banner")).toBeVisible();
    await page.screenshot({ path: `${dir}/m3c-order-pending-new.png`, fullPage: true });

    order = makeOrder(CONFIRMED);
    await page.goto(ORDER_PATH);
    await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.confirmed);
    await page.screenshot({ path: `${dir}/m3c-order-confirmed-cancel.png`, fullPage: true });
  });
});
