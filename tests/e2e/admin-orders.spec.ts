// Admin orders e2e: list -> quick filter -> inline next status -> detail -> reject -> payment.
// The dev server must run against the *_test database (the local Playwright config does).

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";
import { screensDir } from "./support/screensDir";

const t = copy.admin.orders;
const SCREENS = screensDir();

function ymd(offsetDays: number): string {
  // Chicago calendar day, offset.
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  base.setDate(base.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seed(): Promise<{ token: string; ids: string[] }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const tomorrow = ymd(1);
  const later = ymd(3);
  const ids = await withDb(async (c) => {
    await c.query(`TRUNCATE "AuditLog","OrderItem","Order","OpenDateProductLimit","OpenDate","Product","AdminSession","AdminUser" CASCADE`);
    const u = await c.query(
      `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'e2e-orders', 'x', now()) RETURNING id`,
    );
    await c.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt") VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [tokenHash, u.rows[0].id],
    );
    await c.query(`INSERT INTO "Setting" (id, "orderingEnabled", "updatedAt") VALUES (1, true, now()) ON CONFLICT (id) DO NOTHING`);
    const prod = await c.query(
      `INSERT INTO "Product" (id, name, description, "unitPriceCents", "bundleSize", "bundlePriceCents", "capacityMode", "doughG", "updatedAt")
       VALUES (gen_random_uuid(), '奶酥红豆包', 't', 249, 4, 899, 'DOUGH_PER_UNIT', 70, now()) RETURNING id`,
    );
    for (const d of [tomorrow, later]) await c.query(`INSERT INTO "OpenDate" (date, "updatedAt") VALUES ($1, now())`, [d]);
    const out: string[] = [];
    const mk = async (date: string, seq: number, wechat: string, status: string) => {
      const o = await c.query(
        `INSERT INTO "Order" (id, "pickupDate", seq, "orderNo", "viewToken", "wechatId", fulfillment, status, "subtotalCents", "deliveryFeeCents", "totalCents", "cutoffAt", source, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PICKUP', $6::"OrderStatus", 899, 0, 899, now() + interval '1 day', 'WEB', now()) RETURNING id`,
        [date, seq, `${date.slice(5, 7)}${date.slice(8)}-00${seq}`, randomBytes(16).toString("hex"), wechat, status],
      );
      await c.query(
        `INSERT INTO "OrderItem" (id, "orderId", "productId", "nameSnapshot", qty, "unitPriceCents", "bundleSize", "bundlePriceCents", "lineTotalCents")
         VALUES (gen_random_uuid(), $1, $2, '奶酥红豆包', 4, 249, 4, 899, 899)`,
        [o.rows[0].id, prod.rows[0].id],
      );
      out.push(o.rows[0].id);
    };
    await mk(tomorrow, 1, "wx_alice", "NEW");
    await mk(tomorrow, 2, "wx_bob", "CONFIRMED");
    await mk(later, 1, "wx_carol", "NEW");
    return out;
  });
  return { token, ids };
}

async function login(context: BrowserContext, baseURL: string, token: string) {
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

test("list -> quick filter -> inline status -> detail -> reject -> payment", async ({ page, context, baseURL }) => {
  const { token } = await seed();
  await login(context, baseURL!, token);

  await page.goto("/admin/orders");
  await expect(page.getByTestId("order-row")).toHaveCount(3);
  await page.getByRole("button", { name: t.filters, exact: true }).click();
  await page.getByRole("button", { name: t.allDates, exact: true }).click();
  await expect(page).toHaveURL(/date=all/);
  await expect(page.getByTestId("order-row").first()).toContainText("wx_carol");
  await page.reload();
  await page.getByRole("button", { name: t.filters, exact: true }).click();
  await expect(page.getByRole("button", { name: t.allDates, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: t.upcomingDates, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByTestId("order-row").first()).toContainText("wx_alice");
  await page.getByRole("button", { name: t.filters, exact: true }).click();
  await page.screenshot({ path: `${SCREENS}/m4c-orders.png`, fullPage: true });

  // No horizontal scroll at 320px.
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });

  // Quick filter 明天 (wait for the list to load so "today" is known).
  const tomorrowBtn = page.getByRole("button", { name: t.quickTomorrow });
  await expect(tomorrowBtn).toBeEnabled();
  await tomorrowBtn.click();
  await expect(page.getByTestId("order-row")).toHaveCount(2);
  await expect(page).toHaveURL(/date=/);

  // Quick filter 未确认.
  await page.getByRole("button", { name: t.quickUnconfirmed }).click();
  await expect(page.getByTestId("order-row")).toHaveCount(2); // alice (tomorrow) + carol (later)

  // Inline next status on alice.
  const alice = page.getByTestId("order-row").filter({ hasText: "wx_alice" });
  await alice.getByRole("button", { name: t.moveTo.CONTACTED }).click();
  await expect(alice.getByText(t.statusLabels.CONTACTED, { exact: true })).toBeVisible();
  await expect(alice.getByRole("button", { name: t.moveTo.CONFIRMED })).toBeVisible();

  // Detail.
  await alice.getByRole("link", { name: /0\d{3}-001|\d{4}-001/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: t.copyLink })).toBeVisible();
  await expect(page.getByRole("link", { name: t.edit })).toBeVisible();
  await expect(page.getByTestId("log-entry")).toHaveCount(1);
  await page.screenshot({ path: `${SCREENS}/m4c-order-detail.png`, fullPage: true });

  // Reject needs a reason.
  await page.getByRole("button", { name: t.reject, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t.confirmReject }).click();
  await expect(dialog.getByText(t.reasonRequired)).toBeVisible();
  await dialog.getByRole("textbox").fill("联系不上");
  await dialog.getByRole("button", { name: t.confirmReject }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(t.statusLabels.REJECTED, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("log-entry")).toHaveCount(2);

  // Payment toggle + method.
  const toggle = page.getByLabel(t.paymentToggle);
  await toggle.click(); // controlled: flips after the server round trip
  await expect(toggle).toBeChecked();
  await page.getByLabel(t.paymentMethod).selectOption("ZELLE");
  await expect(page.getByLabel(t.paymentMethod)).toHaveValue("ZELLE");
  await expect(page.getByTestId("log-entry")).toHaveCount(4);
});

test("a stale inline status change shows the refresh message", async ({ page, context, baseURL }) => {
  const { token, ids } = await seed();
  await login(context, baseURL!, token);
  await page.goto("/admin/orders");
  await expect(page.getByTestId("order-row")).toHaveCount(3);
  // Someone else changes alice's order.
  await withDb((c) => c.query(`UPDATE "Order" SET status = 'CONTACTED', "updatedAt" = now() + interval '1 second' WHERE id = $1`, [ids[0]]));
  const alice = page.getByTestId("order-row").filter({ hasText: "wx_alice" });
  await alice.getByRole("button", { name: t.moveTo.CONTACTED }).click();
  await expect(alice.getByRole("alert")).toHaveText(copy.errors.STALE);
});
