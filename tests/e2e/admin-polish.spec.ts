// Admin polish e2e (J4): Esc on confirm dialogs, status buttons, readable logs, ledger
// 未注明, phone calendar cells, archived products on the dashboard, order search, header logo.
// Runs against the *_test database like the other admin specs.

import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import {
  chicagoToday,
  createAdminSession,
  insertOrder,
  ITEM,
  resetAndSeed,
  withDb,
} from "./support/seed";

const orders = copy.admin.orders;
const dash = copy.admin.dashboard;
const ledger = copy.admin.ledger;
const cal = copy.admin.calendar;

async function loginAsAdmin(page: Page, baseURL: string, name: string) {
  const token = await createAdminSession(name);
  await page.context().addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

test("Esc closes the pause-ordering confirmation without pausing", async ({ page, baseURL }) => {
  await resetAndSeed({ openTomorrow: true });
  await loginAsAdmin(page, baseURL!, "e2e-polish-esc");
  await page.goto("/admin");
  await expect(page.getByTestId("ordering-state")).toHaveText(dash.orderingOn);
  await page.getByRole("button", { name: dash.turnOff }).click();
  const dialog = page.getByRole("dialog", { name: dash.pauseConfirmTitle });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("ordering-state")).toHaveText(dash.orderingOn);
});

test("status buttons: only the next step is prominent, jumps ask first, delivery says 配送中, logs read in Chinese", async ({
  page,
  baseURL,
}) => {
  const seeded = await resetAndSeed({ openTomorrow: true });
  const date = seeded.dates.d1;
  const confirmed = await insertOrder({ date, wechatId: "dora", status: "CONFIRMED", items: [ITEM.red(seeded.products.red, 2)] });
  const baking = await insertOrder({ date, wechatId: "dan", status: "BAKING", items: [ITEM.red(seeded.products.red, 1)] });
  await withDb((c) =>
    c.query(`UPDATE "Order" SET fulfillment = 'DELIVERY', "deliveryFeeCents" = 500, "totalCents" = "subtotalCents" + 500 WHERE id = ANY($1)`, [
      [confirmed.id, baking.id],
    ]),
  );
  await loginAsAdmin(page, baseURL!, "e2e-polish-status");

  // Delivery order in BAKING: the next step reads 标为配送中, and the chip says 配送中 afterwards.
  await page.goto(`/admin/orders/${baking.id}`);
  await page.getByRole("button", { name: orders.moveToReadyDelivery }).click();
  await expect(page.getByText(orders.readyDelivery, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(orders.statusLabels.READY, { exact: true })).toHaveCount(0);

  // CONFIRMED delivery order: one prominent next button, the rest are 直接… jumps.
  await page.goto(`/admin/orders/${confirmed.id}`);
  await expect(page.getByRole("button", { name: orders.moveTo.BAKING, exact: true })).toBeVisible();
  const toDone = page.getByRole("button", { name: orders.jumpTo.replace("{label}", orders.moveTo.COMPLETED) });
  await expect(page.getByRole("button", { name: orders.jumpTo.replace("{label}", orders.moveToReadyDelivery) })).toBeVisible();
  await expect(page.getByRole("button", { name: orders.moveTo.COMPLETED, exact: true })).toHaveCount(0);

  // A jump asks first; Esc backs out without changing anything.
  await toDone.click();
  const dialog = page.getByRole("dialog", { name: orders.jumpTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${orders.statusLabels.BAKING}、${orders.readyDelivery}`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByText(orders.statusLabels.CONFIRMED, { exact: true }).first()).toBeVisible();

  // Confirming goes through.
  await toDone.click();
  await page.getByRole("dialog").getByRole("button", { name: orders.jumpConfirm }).click();
  await expect(page.getByText(orders.statusLabels.COMPLETED, { exact: true }).first()).toBeVisible();

  // The order's own log and the global log: Chinese words, no enums, no raw JSON.
  await expect(page.getByTestId("log-entry").first()).toContainText(
    `${orders.statusLabels.CONFIRMED}${orders.arrow}${orders.statusLabels.COMPLETED}`,
  );
  await page.goto("/admin/logs");
  const first = page.getByTestId("log-entry").first();
  await expect(first).toContainText(copy.admin.logs.actions["order.status"]);
  const text = await page.getByRole("main").innerText();
  expect(text).not.toMatch(/CONFIRMED|COMPLETED|BAKING|DELIVERY|Cents|[{}[\]"]|\d{4}-\d{2}-\d{2}T/);
});

test("order search treats % and _ as plain characters", async ({ page, baseURL }) => {
  const seeded = await resetAndSeed({ openTomorrow: true });
  const date = seeded.dates.d1;
  await insertOrder({ date, wechatId: "a_b", items: [ITEM.red(seeded.products.red, 1)] });
  await insertOrder({ date, wechatId: "axb", items: [ITEM.red(seeded.products.red, 1)] });
  await loginAsAdmin(page, baseURL!, "e2e-polish-search");
  await page.goto("/admin/orders");
  await expect(page.getByTestId("order-row")).toHaveCount(2);
  const search = page.getByRole("searchbox");
  await search.fill("a_b");
  await search.press("Enter");
  await expect(page.getByTestId("order-row")).toHaveCount(1);
  await expect(page.getByTestId("order-row")).toContainText("a_b");
  await search.fill("%");
  await search.press("Enter");
  await expect(page.getByTestId("order-row")).toHaveCount(0);
});

test("ledger: a paid order without a method is 未注明, not 其他", async ({ page, baseURL }) => {
  const seeded = await resetAndSeed({ openTomorrow: true });
  const date = seeded.dates.d1;
  const o = await insertOrder({ date, wechatId: "nomethod", status: "COMPLETED", items: [ITEM.red(seeded.products.red, 2)] });
  await withDb((c) => c.query(`UPDATE "Order" SET paid = true, "paidMethod" = NULL WHERE id = $1`, [o.id]));
  await loginAsAdmin(page, baseURL!, "e2e-polish-ledger");
  await page.goto("/admin/ledger");
  const [year, month] = date.split("-").map(Number);
  const label = ledger.monthLabel.replace("{year}", String(year)).replace("{month}", String(month));
  if ((await page.getByTestId("ledger-month-label").textContent()) !== label) {
    await page.getByRole("button", { name: ledger.nextMonth }).click();
  }
  await expect(page.getByTestId("ledger-month-label")).toHaveText(label);
  await expect(page.getByTestId("month-method-UNSPECIFIED")).toHaveText("$4.98");
  await expect(page.getByTestId("month-method-OTHER")).toHaveText("$0.00");
  await page.getByTestId(`ledger-day-${date}`).click();
  await expect(page.getByTestId(`ledger-order-${o.orderNo}`)).toContainText(ledger.methods.UNSPECIFIED);
  await expect(page.getByTestId("day-method-UNSPECIFIED")).toHaveText("$4.98");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("calendar on a phone: equal-height cells, no wrapped usage text; full usage on a wide screen and in the day sheet", async ({
  page,
  baseURL,
}) => {
  const seeded = await resetAndSeed({ openTomorrow: true });
  const date = seeded.dates.d1;
  await insertOrder({ date, wechatId: "cal", status: "CONFIRMED", items: [ITEM.red(seeded.products.red, 4)] });
  await loginAsAdmin(page, baseURL!, "e2e-polish-cal");
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/admin/calendar");
  const grid = page.getByTestId("calendar-grid");
  await expect(grid).toBeVisible();
  if (date.slice(0, 7) !== chicagoToday().slice(0, 7)) await page.getByRole("button", { name: cal.nextMonth }).click();
  const cell = page.locator(`[data-date="${date}"]`);
  await expect(cell).toContainText("1 单");

  const metrics = await grid.locator("[data-date]").evaluateAll((els) =>
    els.map((el) => ({
      h: Math.round(el.getBoundingClientRect().height),
      overflowX: el.scrollWidth > el.clientWidth + 1,
      overflowY: el.scrollHeight > el.clientHeight + 1,
    })),
  );
  expect(metrics.length).toBeGreaterThanOrEqual(28);
  expect(new Set(metrics.map((m) => m.h)).size).toBe(1);
  expect(metrics.some((m) => m.overflowX || m.overflowY)).toBe(false);
  // The dough numbers are not crammed into the cell on a phone.
  expect(await cell.innerText()).not.toContain("1600");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // ... they are one tap away.
  await cell.click();
  await expect(page.getByTestId("day-usage")).toContainText("280 / 1600 g");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(cell).toContainText("280 / 1600 g");
  expect(new Set(await grid.locator("[data-date]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))).size).toBe(1);
});

test("archived products disappear from the dashboard day cards", async ({ page, baseURL }) => {
  const seeded = await resetAndSeed({ openTomorrow: true });
  await loginAsAdmin(page, baseURL!, "e2e-polish-archive");
  await page.goto("/admin");
  const tomorrow = page.getByTestId("card-tomorrow");
  await expect(tomorrow).toContainText("焦糖布蕾 0 / 24");
  await withDb((c) => c.query(`UPDATE "Product" SET status = 'ARCHIVED' WHERE id = $1`, [seeded.products.brulee]));
  await page.reload();
  await expect(tomorrow).toBeVisible();
  await expect(tomorrow).not.toContainText("焦糖布蕾");
});

test("the admin header uses the real logo", async ({ page, baseURL }) => {
  await resetAndSeed({ openTomorrow: true });
  await loginAsAdmin(page, baseURL!, "e2e-polish-logo");
  await page.goto("/admin");
  const logo = page.locator('header img[src="/brand/logo.webp"]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await logo.evaluate((img) => img.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
