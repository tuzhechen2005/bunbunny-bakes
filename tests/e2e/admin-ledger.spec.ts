// Admin bookkeeping e2e: month summary and day detail from seeded orders (paid / unpaid /
// cancelled, a bundle product bought 2 + 2 by two customers), then add / edit / delete a
// manual entry and watch the totals and the audit log. Runs against the *_test database.

import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, insertOrder, ITEM, resetAndSeed, withDb } from "./support/seed";

const t = copy.admin.ledger;
const SCREENS = process.env.SCREENS_DIR ?? "test-results/screens";

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

/** Opens /admin/ledger and moves to the month that contains `date`. */
async function openMonthOf(page: Page, date: string) {
  await page.goto("/admin/ledger");
  const [year, month] = date.split("-").map(Number);
  const label = t.monthLabel.replace("{year}", String(year)).replace("{month}", String(month));
  for (let i = 0; i < 2; i++) {
    if ((await page.getByTestId("ledger-month-label").textContent()) === label) return;
    await page.getByRole("button", { name: t.nextMonth }).click();
  }
  await expect(page.getByTestId("ledger-month-label")).toHaveText(label);
}

test("unauthenticated /admin/ledger redirects to login", async ({ page }) => {
  await page.goto("/admin/ledger");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("month summary, day detail, and manual entry add / edit / delete", async ({ page, context, baseURL }) => {
  const seeded = await resetAndSeed();
  await withDb((c) => c.query(`TRUNCATE "ManualIncomeItem","ManualIncome" CASCADE`));
  const date = seeded.dates.d1;
  const red = seeded.products.red;

  // Two customers, 2 red bean each (bundle price would apply to 4: 8.99, but each order pays 2 x 2.49).
  const a = await insertOrder({ date, wechatId: "alice", status: "COMPLETED", items: [ITEM.red(red, 2)] });
  const b = await insertOrder({ date, wechatId: "bob", status: "CONFIRMED", items: [ITEM.red(red, 2)] });
  const c = await insertOrder({ date, wechatId: "cara", status: "CONFIRMED", items: [ITEM.wedge(seeded.products.wedge, 1)] });
  await insertOrder({ date, wechatId: "dan", status: "CANCELLED", items: [ITEM.red(red, 1)] });
  await withDb(async (db) => {
    await db.query(`UPDATE "Order" SET paid = true, "paidMethod" = 'WECHAT' WHERE id = $1`, [a.id]);
    await db.query(`UPDATE "Order" SET paid = true, "paidMethod" = 'ZELLE' WHERE id = $1`, [b.id]);
  });

  const token = await createAdminSession("e2e-ledger");
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL! }]);

  // ---- month view
  await openMonthOf(page, date);
  await expect(page.getByTestId("month-revenue")).toHaveText("$9.96");
  await expect(page.getByTestId("month-qty")).toHaveText("4");
  await expect(page.getByTestId("month-receivable")).toHaveText("$2.99");
  await expect(page.getByTestId("month-method-WECHAT")).toHaveText("$4.98");
  await expect(page.getByTestId("month-method-ZELLE")).toHaveText("$4.98");
  await expect(page.getByTestId("month-method-CASH")).toHaveText("$0.00");
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SCREENS}/h2_ledger-month.png`, fullPage: true });

  // ---- day detail
  await page.getByTestId(`ledger-day-${date}`).click();
  await expect(page.getByTestId(`ledger-order-${a.orderNo}`)).toBeVisible();
  await expect(page.getByTestId(`ledger-order-${c.orderNo}`)).toContainText(t.pendingTag);
  await expect(page.getByTestId("day-revenue")).toHaveText("$9.96");
  await expect(page.getByTestId("day-receivable")).toHaveText("$2.99");
  // 2 + 2 red beans: 2 x 2.49 each = $9.96, not the bundle price $8.99.
  const redRow = page.getByTestId("ledger-product-row").filter({ hasText: "奶酥红豆包" });
  await expect(redRow).toContainText("4");
  await expect(redRow).toContainText("$9.96");
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SCREENS}/h2_ledger-day.png`, fullPage: true });

  // ---- add a manual entry (cash, 3 red beans)
  await page.getByRole("button", { name: t.addEntry }).click();
  const form = page.getByTestId("ledger-form");
  await expect(form).toBeVisible();
  await form.getByLabel(t.amount).fill("12.50");
  await form.getByLabel(t.note).fill("现场售卖");
  await form.getByLabel(t.method).selectOption("CASH");
  await form.getByRole("button", { name: t.addItem }).click();
  await form.getByTestId("ledger-item-product-0").selectOption({ label: "奶酥红豆包" });
  await form.getByTestId("ledger-item-qty-0").fill("3");
  await page.screenshot({ path: `${SCREENS}/h2_ledger-form.png` });
  await form.getByRole("button", { name: t.save }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId("day-revenue")).toHaveText("$22.46");
  await expect(page.getByTestId("day-qty")).toHaveText("7");
  await expect(page.getByTestId("day-method-CASH")).toHaveText("$12.50");
  await expect(redRow).toContainText("7");
  await expect(page.getByTestId("ledger-manual-row")).toContainText("现场售卖");

  // ---- edit it: amount 20.00
  await page.getByRole("button", { name: t.edit }).click();
  await form.getByLabel(t.amount).fill("20");
  await form.getByRole("button", { name: t.save }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId("day-revenue")).toHaveText("$29.96");

  // ---- invalid input stays in the form
  await page.getByRole("button", { name: t.edit }).click();
  await form.getByLabel(t.amount).fill("0");
  await form.getByRole("button", { name: t.save }).click();
  await expect(form.getByText(t.errAmount)).toBeVisible();
  await form.getByRole("button", { name: t.cancel }).click();
  await expect(page.getByTestId("day-revenue")).toHaveText("$29.96");

  // ---- month view includes it
  await page.getByRole("button", { name: t.backToMonth }).click();
  await expect(page.getByTestId("month-revenue")).toHaveText("$29.96");

  // ---- delete with confirmation
  await page.getByTestId(`ledger-day-${date}`).click();
  await page.getByRole("button", { name: t.remove }).click();
  await expect(page.getByRole("dialog", { name: t.deleteTitle })).toBeVisible();
  await page.getByRole("button", { name: t.cancel }).click();
  await expect(page.getByTestId("ledger-manual-row")).toBeVisible();
  await page.getByRole("button", { name: t.remove }).click();
  await page.getByRole("button", { name: t.deleteYes }).click();
  await expect(page.getByTestId("ledger-manual-row")).toHaveCount(0);
  await expect(page.getByTestId("day-revenue")).toHaveText("$9.96");

  // ---- audit log rows
  const actions = await withDb(async (db) =>
    (
      await db.query<{ action: string }>(
        `SELECT action FROM "AuditLog" WHERE "entityType" = 'manual_income' ORDER BY at`,
      )
    ).rows.map((r) => r.action),
  );
  expect(actions).toEqual(["manual_income.create", "manual_income.update", "manual_income.delete"]);
  await page.goto("/admin/logs");
  await expect(page.getByTestId("log-entry").filter({ hasText: copy.admin.logs.actions["manual_income.create"] })).toBeVisible();
});

test("reachable from the admin menu, 320 px without horizontal scroll", async ({ page, context, baseURL }) => {
  await resetAndSeed();
  await context.addCookies([{ name: "bb_session", value: await createAdminSession("e2e-ledger"), url: baseURL! }]);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/admin");
  await page.getByRole("button", { name: copy.admin.shell.openMenu }).click();
  await page
    .getByRole("navigation", { name: copy.admin.shell.mainNav })
    .getByRole("link", { name: copy.admin.shell.ledger, exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/ledger$/);
  await expect(page.getByRole("heading", { name: t.title })).toBeVisible();
  await expect(page.getByTestId("ledger-month-empty")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
