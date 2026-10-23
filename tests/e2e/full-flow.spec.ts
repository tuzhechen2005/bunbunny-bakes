// Full-flow e2e against the REAL backend (no page.route mocks): M3 + M4 acceptance, PRD §9.
// The dev server must run against a *_test database (the local Playwright config sets it
// and TEST_DATABASE_URL). Every test truncates and re-seeds that database.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import {
  createAdminSession,
  fillDay,
  insertOrder,
  ITEM,
  resetAndSeed,
  setOrderingEnabled,
  withDb,
  type Seeded,
} from "./support/seed";

test.describe.configure({ mode: "serial" });

const ord = copy.admin.orders;
const form = copy.admin.orderForm;
const chk = copy.customer.checkout;
const ordPage = copy.customer.order;

let seeded: Seeded;

function card(page: Page, name: string) {
  return page.getByTestId("product-card").filter({ hasText: name });
}

async function add(page: Page, name: string, n: number) {
  const plus = card(page, name).getByRole("button", { name: copy.customer.home.increase });
  for (let i = 0; i < n; i++) await plus.click();
}

/** Home: red bean x4 + cheese wedge x4 ($8.99 + $10.99 = $19.98), then to checkout. */
async function fillCart(page: Page) {
  await page.goto("/");
  await expect(card(page, "奶酥红豆包")).toBeVisible();
  await add(page, "奶酥红豆包", 4);
  await add(page, "奶酪角", 4);
  await expect(page.getByTestId("bag-count")).toContainText("8");
  await expect(page.getByTestId("bag-subtotal")).toContainText("19.98");
  await page.getByTestId("bag-pill").click(); // 去结算 lives in the bag sheet
  await page.getByTestId("bag-checkout").click();
  await expect(page).toHaveURL(/\/checkout$/);
}

function dateCard(page: Page, date: string) {
  return page.locator(`[data-testid="date-card"][data-date="${date}"]`);
}

async function loginAsAdmin(context: BrowserContext, baseURL: string) {
  const token = await createAdminSession();
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

test("1. customer happy path -> order page -> cancel", async ({ page }) => {
  seeded = await resetAndSeed();
  await fillCart(page);

  const firstAvailable = page.locator('[data-testid="date-card"][data-state="AVAILABLE"]').first();
  await expect(firstAvailable).toBeVisible();
  await expect(page.getByTestId("total-total")).toHaveText("$19.98");
  await firstAvailable.click();
  await page.getByLabel(chk.pickup).check();
  await page.getByLabel(chk.wechatLabel).fill("e2e_customer_01");
  await page.getByTestId("submit").click();

  await page.waitForURL(/\/o\/[^/?]+\?new=1$/);
  await expect(page.getByTestId("new-title")).toContainText(ordPage.newTitle);
  await expect(page.getByTestId("status-text")).toHaveText(
    copy.customerStatus.pending.replace("{ownerWechatId}", "bunbunny_bakes"),
  );
  await expect(page.getByTestId("status-text")).toContainText("已收到，等待确认");
  await expect(page.getByTestId("total")).toHaveText("$19.98");

  // Reload: the success banner is gone, the order is still there.
  await page.reload();
  await expect(page.getByTestId("status-text")).toBeVisible();
  await expect(page.getByTestId("new-banner")).toHaveCount(0);
  await expect(page.getByTestId("total")).toHaveText("$19.98");

  await page.getByRole("button", { name: ordPage.cancelOrder }).click();
  await page.getByRole("dialog").getByRole("button", { name: ordPage.cancelConfirm }).click();
  await expect(page.getByTestId("status-text")).toHaveText(copy.customerStatus.cancelled);
  await expect(page.getByRole("button", { name: ordPage.cancelOrder })).toHaveCount(0);

  // Database state.
  const db = await withDb(async (c) => {
    const o = (await c.query(`SELECT id, status, "ipHash", "totalCents", "cancelledBy" FROM "Order"`)).rows;
    const audit = (await c.query(`SELECT action, actor FROM "AuditLog" ORDER BY at`)).rows;
    const notes = (await c.query(`SELECT "dedupeKey", kind FROM "Notification"`)).rows;
    return { o, audit, notes };
  });
  expect(db.o).toHaveLength(1);
  const order = db.o[0];
  expect(order.status).toBe("CANCELLED");
  expect(order.cancelledBy).toBe("CUSTOMER");
  expect(order.totalCents).toBe(1998);
  expect(order.ipHash).toMatch(/^[0-9a-f]{64}$/);
  expect(db.audit.map((a: { action: string }) => a.action)).toEqual(
    expect.arrayContaining(["order.create", "order.cancel"]),
  );
  const keys = db.notes.map((n: { dedupeKey: string }) => n.dedupeKey);
  expect(keys).toContain(`new_order:${order.id}`);
  expect(keys).toContain(`customer_cancelled:${order.id}`);
});

test("2. a full day shows 已满 and the next day is selectable", async ({ page }) => {
  seeded = await resetAndSeed();
  await fillDay(seeded.dates.d1, seeded.products);
  await fillCart(page);

  await expect(page.getByTestId("date-card").first()).toBeVisible();
  const full = dateCard(page, seeded.dates.d1);
  await expect(full).toContainText(chk.stateFull);
  await expect(full).toBeDisabled();
  const next = dateCard(page, seeded.dates.d2);
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toHaveAttribute("aria-pressed", "true");
});

test("3. delivery fee and the free-delivery nudge", async ({ page }) => {
  seeded = await resetAndSeed();
  await fillCart(page);
  await expect(page.getByTestId("date-card").first()).toBeVisible();
  await page.getByLabel(chk.delivery).check();
  await dateCard(page, seeded.dates.d1).click();
  await expect(page.getByTestId("total-fee")).toHaveText("$5.00");
  await expect(page.getByTestId("total-total")).toHaveText("$24.98");
  await expect(page.getByTestId("delivery-gap")).toHaveText("还差 $5.02");
  await expect(page.getByTestId("delivery-fee")).toHaveText("满 $25 免运费");
});

test("4. admin: dashboard, contact, confirm, payment, audit log, auth", async ({ page, context, baseURL, request }) => {
  seeded = await resetAndSeed({ openTomorrow: true });
  const { id, orderNo } = await insertOrder({
    date: seeded.dates.tomorrow,
    wechatId: "wx_dana",
    status: "NEW",
    items: [ITEM.red(seeded.products.red, 4)],
  });

  // Unauthenticated: page redirects, API says 401.
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: copy.admin.auth.loginTitle })).toBeVisible();
  const res = await request.post(`/api/admin/orders/${id}/status`, {
    data: { to: "CONTACTED" },
    headers: { origin: baseURL! },
  });
  expect(res.status()).toBe(401);

  await loginAsAdmin(context, baseURL!);
  await page.goto("/admin");
  await expect(page.getByText("明天还有 1 笔订单没确认")).toBeVisible();

  await page.goto("/admin/orders");
  const row = page.getByTestId("order-row").filter({ hasText: "wx_dana" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: ord.moveTo.CONTACTED }).click();
  await expect(row.getByText(ord.statusLabels.CONTACTED, { exact: true })).toBeVisible();

  await row.getByRole("link", { name: orderNo }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${id}$`));
  await page.getByRole("button", { name: ord.moveTo.CONFIRMED }).click();
  await expect(page.getByText(ord.statusLabels.CONFIRMED, { exact: true }).first()).toBeVisible();

  const toggle = page.getByLabel(ord.paymentToggle);
  await toggle.click();
  await expect(toggle).toBeChecked();

  const logs = page.getByTestId("log-entry");
  await expect(logs).toHaveCount(3);
  const all = await logs.allInnerTexts();
  const text = all.join("\n");
  expect(text).toContain("新订单 → 已联系");
  expect(text).toContain("已联系 → 已确认");
  expect(text).toMatch(/付款：否 → 是/);

  const audit = await withDb(async (c) =>
    (await c.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY at`, [id])).rows.map(
      (r: { action: string }) => r.action,
    ),
  );
  expect(audit).toEqual(["order.status", "order.status", "order.paid"]);
});

test("5. phone order over the limit: reason required, saved as confirmed, override audited", async ({
  page,
  context,
  baseURL,
}) => {
  seeded = await resetAndSeed();
  await fillDay(seeded.dates.d1, seeded.products);
  await loginAsAdmin(context, baseURL!);

  await page.goto("/admin/orders/new");
  await expect(page.getByRole("heading", { name: form.newTitle })).toBeVisible();
  await expect(page.locator(`[data-date="${seeded.dates.d1}"]`)).toContainText("1600 / 1600 g");
  await page.getByRole("button", { name: /奶酥红豆包 数量 增加/ }).click();
  await page.locator(`[data-testid="date-card"][data-date="${seeded.dates.d1}"]`).click();
  await page.getByLabel(form.wechatLabel).fill("wx_phone_amy");
  await page.getByTestId("submit").click();

  await expect(page.getByTestId("over-limit")).toBeVisible();
  await expect(page.getByTestId("violations").locator("li")).toHaveCount(1);
  await page.getByTestId("override-confirm").click();
  await expect(page.getByTestId("reason-error")).toBeVisible();
  await page.getByTestId("reason").fill("老顾客，我能多做");
  await page.getByTestId("override-confirm").click();
  await expect(page.getByText(form.createdTitle)).toBeVisible();

  const db = await withDb(async (c) => {
    const o = (
      await c.query(`SELECT id, status, source FROM "Order" WHERE "wechatId" = 'wx_phone_amy'`)
    ).rows;
    const a = (
      await c.query(`SELECT action, reason FROM "AuditLog" WHERE action = 'order.override'`)
    ).rows;
    return { o, a };
  });
  expect(db.o).toHaveLength(1);
  expect(db.o[0]).toMatchObject({ status: "CONFIRMED", source: "ADMIN" });
  expect(db.a).toHaveLength(1);
  expect(db.a[0].reason).toBe("老顾客，我能多做");
});

test("6. ordering closed: home says so and checkout cannot submit", async ({ page, request, baseURL }) => {
  seeded = await resetAndSeed();
  // Build a cart while open, then close ordering.
  await fillCart(page);
  await setOrderingEnabled(false);

  await page.goto("/");
  await expect(page.getByText(copy.home.orderingClosed)).toBeVisible();
  await page.getByTestId("bag-pill").click();
  const go = page.getByTestId("bag-checkout");
  await expect(go).toBeDisabled();
  await expect(go).toHaveText(copy.customer.home.checkoutClosed);

  await page.goto("/checkout");
  await page.getByLabel(chk.wechatLabel).fill("e2e_closed");
  await expect(page.getByTestId("submit")).toBeDisabled();
  const count = await withDb(async (c) => (await c.query(`SELECT count(*)::int AS n FROM "Order"`)).rows[0].n);
  expect(count).toBe(0);

  // The API refuses it as well.
  const res = await request.post("/api/orders", {
    headers: { origin: baseURL! },
    data: {
      items: [{ productId: seeded.products.red, qty: 1 }],
      pickupDate: seeded.dates.d1,
      fulfillment: "PICKUP",
      wechatId: "api_closed",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      website: "",
    },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("ORDERING_DISABLED");
});
