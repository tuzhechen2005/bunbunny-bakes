// D115 admin e2e, real APIs against the *_test database: the product form's pickup weekday
// chips, and the owner override of a weekday restriction in the order form.

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";

const SCREENS = "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens";
const t = copy.admin.products;

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
const D1 = isoDay(3);
const D1_WEEKDAY = new Date(`${D1}T12:00:00Z`).getUTCDay();
const OTHER_WEEKDAY = (D1_WEEKDAY + 1) % 7;

interface Seed {
  token: string;
  puff: string;
}

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

async function seed(): Promise<Seed> {
  return withClient(async (client) => {
    await client.query(
      `TRUNCATE "AuditLog", "OrderItem", "Order", "OpenDateProductLimit", "OpenDate", "Product", "Setting", "AdminSession", "AdminUser" RESTART IDENTITY CASCADE`,
    );
    await client.query(`INSERT INTO "Setting" (id, "orderingEnabled", "updatedAt") VALUES (1, true, now())`);
    const puff = (
      await client.query<{ id: string }>(
        `INSERT INTO "Product" (id, name, "unitPriceCents", "capacityMode", "dailyLimit", "sortOrder", "updatedAt")
         VALUES (gen_random_uuid(), '泡芙', 300, 'INDEPENDENT', 20, 1, now()) RETURNING id`,
      )
    ).rows[0].id;
    await client.query(`INSERT INTO "OpenDate" (date, "updatedAt") VALUES ($1, now())`, [D1]);
    const user = (
      await client.query<{ id: string }>(
        `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt") VALUES (gen_random_uuid(), 'e2e-weekday-owner', 'x', now()) RETURNING id`,
      )
    ).rows[0].id;
    const token = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [createHash("sha256").update(token, "utf8").digest("hex"), user],
    );
    return { token, puff };
  });
}

async function login(context: BrowserContext, baseURL: string, token: string) {
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

let s: Seed;
test.beforeEach(async ({ context, baseURL }) => {
  s = await seed();
  await login(context, baseURL!, s.token);
});

test("product form: weekday chips save, reload pressed, and can be cleared", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${s.puff}`);
  const field = page.getByTestId("pickup-weekdays");
  await expect(field).toContainText(t.fieldPickupWeekdays);
  await expect(field).toContainText(t.pickupWeekdaysHint);
  const chip = (d: number) => field.locator(`button[data-weekday="${d}"]`);
  await expect(chip(3)).toHaveAttribute("aria-pressed", "false");
  const box = await chip(3).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);

  await chip(6).click();
  await chip(3).click();
  await expect(chip(3)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: t.save }).click();
  await expect(page.getByText(t.saved)).toBeVisible();
  const stored = await withClient((c) =>
    c.query<{ pickupWeekdays: number[] }>(`SELECT "pickupWeekdays" FROM "Product" WHERE id = $1`, [s.puff]),
  );
  expect(stored.rows[0].pickupWeekdays).toEqual([3, 6]);

  await page.reload();
  await expect(chip(3)).toHaveAttribute("aria-pressed", "true");
  await expect(chip(6)).toHaveAttribute("aria-pressed", "true");
  await expect(chip(0)).toHaveAttribute("aria-pressed", "false");
  await field.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/n1_hints-product-weekdays.png` });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);

  // Clearing every chip = every day ([]).
  await chip(3).click();
  await chip(6).click();
  await page.getByRole("button", { name: t.save }).click();
  await expect(page.getByText(t.saved)).toBeVisible();
  const cleared = await withClient((c) =>
    c.query<{ pickupWeekdays: number[] }>(`SELECT "pickupWeekdays" FROM "Product" WHERE id = $1`, [s.puff]),
  );
  expect(cleared.rows[0].pickupWeekdays).toEqual([]);
  const audits = await withClient((c) =>
    c.query(`SELECT 1 FROM "AuditLog" WHERE "entityId" = $1 AND action = 'product.update'`, [s.puff]),
  );
  expect(audits.rowCount).toBe(2);
});

test("order form: a weekday restriction is listed and can be overridden with a reason", async ({ page }) => {
  await withClient((c) =>
    c.query(`UPDATE "Product" SET "pickupWeekdays" = ARRAY[$1::int] WHERE id = $2`, [OTHER_WEEKDAY, s.puff]),
  );
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin/orders/new");
  await page.getByRole("button", { name: /泡芙 数量 增加/ }).click();
  await page.locator(`[data-testid="date-card"][data-date="${D1}"]`).click();
  await page.getByLabel(copy.admin.orderForm.wechatLabel).fill("wx_weekday");
  await page.getByTestId("submit").click();

  const dialog = page.getByTestId("over-limit");
  await expect(dialog).toBeVisible();
  const days = copy.dates.weekdays[OTHER_WEEKDAY];
  await expect(page.getByTestId("violations")).toContainText(`泡芙：只能${days}取`);
  await page.getByTestId("reason").fill("顾客说好这天来拿");
  await dialog.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENS}/n1_hints-override.png` });
  await page.getByTestId("override-confirm").click();
  await expect(page.getByText(copy.admin.orderForm.createdTitle)).toBeVisible();

  const audit = await withClient((c) =>
    c.query<{ reason: string; after: { violations: { kind: string }[] } }>(
      `SELECT reason, after FROM "AuditLog" WHERE action = 'order.override'`,
    ),
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].reason).toBe("顾客说好这天来拿");
  expect(audit.rows[0].after.violations[0].kind).toBe("WEEKDAY");
});
