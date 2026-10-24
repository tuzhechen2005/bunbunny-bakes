// Admin order form e2e (new + edit). The order write APIs are mocked with page.route
// (another task owns them); /api/admin/order-form is real against the *_test database.

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";

const t = copy.admin.orderForm;

function isoDay(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}
const D1 = isoDay(3);
const D2 = isoDay(4);

interface Seed {
  token: string;
  red: string;
  cheese: string;
}

// Plain SQL: Playwright's CommonJS loader cannot import the generated Prisma client.
async function seed(): Promise<Seed> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE "OrderItem", "Order", "OpenDateProductLimit", "OpenDate", "Product", "Setting", "AdminSession", "AdminUser" RESTART IDENTITY CASCADE`,
    );
    await client.query(`INSERT INTO "Setting" (id, "orderingEnabled", "updatedAt") VALUES (1, true, now())`);
    const mk = async (name: string, price: number, sort: number) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO "Product" (id, name, "unitPriceCents", "bundleSize", "bundlePriceCents", "capacityMode", "doughG", "sortOrder", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, 4, NULL, 'DOUGH_PER_UNIT', 70, $3, now()) RETURNING id`,
          [name, price, sort],
        )
      ).rows[0].id;
    const red = await mk("奶酥红豆包", 249, 1);
    const cheese = await mk("岩烧乳酪包", 500, 2);
    for (const d of [D1, D2]) {
      await client.query(`INSERT INTO "OpenDate" (date, "updatedAt") VALUES ($1, now())`, [d]);
    }
    const user = (
      await client.query<{ id: string }>(
        `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'e2e-form-owner', 'x', now()) RETURNING id`,
      )
    ).rows[0].id;
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [createHash("sha256").update(token, "utf8").digest("hex"), user],
    );
    return { token, red, cheese };
  } finally {
    await client.end();
  }
}

async function login(context: BrowserContext, baseURL: string, token: string) {
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

let s: Seed;
test.beforeEach(async ({ context, baseURL }) => {
  s = await seed();
  await login(context, baseURL!, s.token);
});

async function pickDate(page: Page, date: string) {
  await page.locator(`[data-testid="date-card"][data-date="${date}"]`).click();
}

test("new order: happy path shows the saved message, order no. and customer link", async ({ page }) => {
  let body: Record<string, unknown> = {};
  await page.route("**/api/admin/orders", async (route) => {
    body = route.request().postDataJSON();
    await json(route, 201, { id: "11111111-1111-4111-8111-111111111111", orderNo: "1030-001", viewUrl: "https://shop.test/o/abc" });
  });
  await page.goto("/admin/orders/new");
  await expect(page.getByRole("heading", { name: t.newTitle })).toBeVisible();
  // Usage is shown per date.
  await expect(page.locator(`[data-date="${D1}"]`)).toContainText("0 / 1600 g");

  await page.getByRole("button", { name: /奶酥红豆包 数量 增加/ }).click();
  await page.getByRole("button", { name: /奶酥红豆包 数量 增加/ }).click();
  await expect(page.getByTestId("estimate-total")).toHaveText("$4.98");
  await pickDate(page, D1);
  await page.getByLabel(t.wechatLabel).fill("wx_amy");
  await page.getByTestId("submit").click();

  await expect(page.getByText(t.createdTitle)).toBeVisible();
  await expect(page.getByTestId("created-no")).toContainText("1030-001");
  await expect(page.getByTestId("created-url")).toHaveValue("https://shop.test/o/abc");
  expect(body).toMatchObject({
    items: [{ productId: s.red, qty: 2 }],
    pickupDate: D1,
    fulfillment: "PICKUP",
    wechatId: "wx_amy",
  });
  expect(body).not.toHaveProperty("override");
});

test("new order: OVER_LIMIT lists violations, needs a reason, then resubmits with override", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/admin/orders", async (route) => {
    const b = route.request().postDataJSON();
    bodies.push(b);
    if (!b.override) {
      return json(route, 409, {
        error: "OVER_LIMIT",
        message: copy.errors.OVER_LIMIT,
        violations: [
          { kind: "DOUGH", date: D1, limit: 1600, after: 1720, over: 120 },
          { kind: "DELIVERY", date: D1, limit: 8, after: 9, over: 1 },
        ],
      });
    }
    return json(route, 201, { id: "11111111-1111-4111-8111-111111111111", orderNo: "1030-002", viewUrl: "https://shop.test/o/xyz" });
  });
  await page.goto("/admin/orders/new");
  await page.getByRole("button", { name: /岩烧乳酪包 数量 增加/ }).click();
  await pickDate(page, D1);
  await page.getByLabel(t.wechatLabel).fill("wx_bob");
  await page.getByTestId("submit").click();

  const dialog = page.getByTestId("over-limit");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("violations").locator("li")).toHaveCount(2);
  await expect(dialog).toContainText("超出 120 g");

  await page.getByTestId("override-confirm").click();
  await expect(page.getByTestId("reason-error")).toBeVisible();
  expect(bodies).toHaveLength(1);

  // Esc dismisses the over-limit panel (nothing is sent); submitting again brings it back.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(bodies).toHaveLength(1);
  await page.getByTestId("submit").click();
  await expect(dialog).toBeVisible();
  expect(bodies).toHaveLength(2);
  bodies.pop();

  await page.getByTestId("reason").fill("老顾客，我能多做");
  await dialog.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/m4d-over-limit.png" });
  await page.getByTestId("override-confirm").click();
  await expect(page.getByText(t.createdTitle)).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toMatchObject({ override: true, reason: "老顾客，我能多做" });
});

function orderBody(s: Seed) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    orderNo: "0001-001",
    status: "CONFIRMED",
    pickupDate: D1,
    fulfillment: "PICKUP",
    wechatId: "wx_cat",
    note: null,
    items: [{ productId: s.red, name: "奶酥红豆包", qty: 4, unitPriceCents: 199, bundleSize: 4, bundlePriceCents: null, lineTotalCents: 796 }],
    updatedAt: "2026-10-27T15:00:00.000Z",
  };
}

test("edit: prefilled, snapshot price noted, sends only changed fields + expectedUpdatedAt", async ({ page }) => {
  const order = orderBody(s);
  let patch: Record<string, unknown> | null = null;
  await page.route("**/api/admin/orders/*", async (route) => {
    if (route.request().method() === "PATCH") {
      patch = route.request().postDataJSON();
      return json(route, 200, { id: order.id, updatedAt: "2026-10-27T16:00:00.000Z" });
    }
    return json(route, 200, order);
  });
  await page.goto(`/admin/orders/${order.id}/edit`);
  await expect(page.getByRole("heading", { name: t.editTitle.replace("{orderNo}", "0001-001") })).toBeVisible();
  await expect(page.getByLabel(t.wechatLabel)).toHaveValue("wx_cat");
  await expect(page.getByLabel("奶酥红豆包 数量", { exact: true })).toHaveValue("4");
  await expect(page.locator(`[data-date="${D1}"]`)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(t.snapshotNote.replace(/[（）]/g, ""), { exact: false }).first()).toBeVisible();

  // Nothing changed -> no request.
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("form-error")).toContainText(t.nothingChanged);
  expect(patch).toBeNull();

  await pickDate(page, D2);
  await expect(page.getByTestId("date-hint")).toBeVisible();
  await page.getByLabel(t.wechatLabel).fill("wx_cat2");
  await page.getByTestId("submit").click();
  await expect.poll(() => patch).not.toBeNull();
  expect(patch).toEqual({ pickupDate: D2, wechatId: "wx_cat2", expectedUpdatedAt: order.updatedAt });
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${order.id}$`));
});

test("edit: STALE shows the message and a refresh button", async ({ page }) => {
  const order = orderBody(s);
  await page.route("**/api/admin/orders/*", async (route) => {
    if (route.request().method() === "PATCH") {
      return json(route, 409, { error: "STALE", message: copy.errors.STALE });
    }
    return json(route, 200, order);
  });
  await page.goto(`/admin/orders/${order.id}/edit`);
  await page.getByLabel(t.wechatLabel).fill("changed");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("form-error")).toContainText(copy.errors.STALE);
  await expect(page.getByRole("button", { name: t.refresh })).toBeVisible();
});

test("new order: editing any field after OVER_LIMIT closes the panel; the button reads 仍然保存（请写原因）", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/admin/orders", async (route) => {
    bodies.push(route.request().postDataJSON());
    return json(route, 409, {
      error: "OVER_LIMIT",
      message: copy.errors.OVER_LIMIT,
      violations: [{ kind: "DOUGH", date: D1, limit: 1600, after: 1720, over: 120 }],
    });
  });
  await page.goto("/admin/orders/new");
  await page.getByRole("button", { name: /岩烧乳酪包 数量 增加/ }).click();
  await pickDate(page, D1);
  await page.getByLabel(t.wechatLabel).fill("wx_bob");

  const panel = page.getByTestId("over-limit");
  const reopen = async () => {
    await page.getByTestId("submit").click();
    await expect(panel).toBeVisible();
  };

  await reopen();
  await expect(page.getByTestId("override-confirm")).toHaveText("仍然保存（请写原因）");
  await page.getByTestId("reason").fill("because");

  // Each kind of change closes the panel and clears the reason.
  const changes: Array<() => Promise<void>> = [
    () => page.getByRole("button", { name: /岩烧乳酪包 数量 增加/ }).click(),
    () => pickDate(page, D2),
    () => page.getByLabel(t.delivery).check(),
    () => page.getByLabel(t.wechatLabel).fill("wx_bob2"),
    () => page.getByLabel(t.noteLabel).fill("note"),
  ];
  for (const change of changes) {
    await change();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId("submit")).toBeVisible();
    await reopen();
    await expect(page.getByTestId("reason")).toHaveValue("");
    await page.getByTestId("reason").fill("because");
  }
  // No request ever carried an override.
  expect(bodies.every((b) => !("override" in b))).toBe(true);
});
