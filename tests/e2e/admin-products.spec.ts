// Admin products e2e. The dev server must run against the *_test database (the local
// Playwright config sets DATABASE_URL); this spec seeds an admin + session there.

import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";
import { screensDir } from "./support/screensDir";

const t = copy.admin.products;
const USERNAME = "e2e-products-owner";
const SCREENSHOT = path.join(screensDir(), "m5b-products.png");

// Plain SQL: Playwright's CommonJS loader cannot import the generated Prisma client.
async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createAdminSession(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'not-a-real-hash', now())
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
       RETURNING id`,
      [USERNAME],
    );
    await client.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [tokenHash, rows[0].id],
    );
  });
  return token;
}

test("create a product, edit its price, change its mode, and see it in the list", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  // Two existing products make the reorder buttons and the list meaningful.
  await withClient(async (c) => {
    await c.query(`DELETE FROM "Product" WHERE name LIKE 'E2E%'`);
    await c.query(
      `INSERT INTO "Product" (id, name, "unitPriceCents", "capacityMode", "doughG", "leadDays", "sortOrder", "updatedAt")
       SELECT gen_random_uuid(), 'E2E 奶酥红豆包', 249, 'DOUGH_PER_UNIT', 70, 1, 900, now()
       WHERE NOT EXISTS (SELECT 1 FROM "Product" WHERE name = 'E2E 奶酥红豆包')`,
    );
  });
  await context.addCookies([{ name: "bb_session", value: await createAdminSession(), url: baseURL! }]);

  const name = `E2E 大圆包 ${Date.now()}`;

  // --- create ---
  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { name: t.title })).toBeVisible();
  await expect(page.getByText("E2E 奶酥红豆包")).toBeVisible();
  await page.getByRole("link", { name: t.addProduct }).click();
  await expect(page).toHaveURL(/\/admin\/products\/new$/);

  await page.locator('input[name="name"]:visible').fill(name);
  await page.locator('input[name="unitPrice"]:visible').fill("1.005");
  await page.locator('input[name="doughG"]:visible').fill("80");
  await page.getByRole("button", { name: t.create }).click();
  // 1.005 is rejected on the client: more than two decimals.
  await expect(page.getByText(t.moneyInvalid)).toBeVisible();
  await page.locator('input[name="unitPrice"]:visible').fill("2.49");
  await page.locator('input[name="bundlePrice"]:visible').fill("8.99");
  await page.getByRole("button", { name: t.create }).click();

  await expect(page).toHaveURL(/\/admin\/products$/);
  const card = page.getByRole("listitem").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("单价 $2.49 · 4 个 $8.99");
  await expect(card).toContainText("按个算面团 80 g");
  await expect(card).toContainText(t.statusActive);

  // --- edit the price ---
  await card.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: t.editTitle })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.locator('input[name="unitPrice"]:visible')).toHaveValue("2.49");
  await page.locator('input[name="unitPrice"]:visible').fill("2.99");
  await page.getByRole("button", { name: t.save }).click();
  await expect(page.getByText(t.saved)).toBeVisible();

  // --- change the mode ---
  await page.getByRole("radio", { name: new RegExp(t.modeIndependentOption) }).check();
  await expect(page.locator('input[name="doughG"]:visible')).toHaveCount(0);
  await page.locator('input[name="dailyLimit"]:visible').fill("12");
  await page.getByRole("button", { name: t.save }).click();
  await expect(page.getByText(t.saved)).toBeVisible();

  // No horizontal scroll at 375px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // --- back to the list ---
  await page.getByRole("link", { name: t.backToList }).click();
  const updated = page.getByRole("listitem").filter({ hasText: name });
  await expect(updated).toContainText("单价 $2.99 · 4 个 $8.99");
  await expect(updated).toContainText("独立限额 每天 12");

  // --- reorder: move the new product up (above the E2E 奶酥红豆包 at 900 if it is below) ---
  const before = await page.getByRole("listitem").allInnerTexts();
  const index = before.findIndex((x) => x.includes(name));
  if (index > 0) {
    await updated.getByRole("button", { name: new RegExp(t.moveUp) }).click();
    await expect
      .poll(async () => (await page.getByRole("listitem").allInnerTexts()).findIndex((x) => x.includes(name)))
      .toBe(index - 1);
  }

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
});
