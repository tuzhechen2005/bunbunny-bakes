// Admin dashboard e2e. The dev server must run against the *_test database (the local
// Playwright config sets DATABASE_URL); this spec resets and seeds that database.

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";

const t = copy.admin.dashboard;
const SCREENSHOT = "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/m4b-dashboard.png";

/** Chicago calendar day of now + offset days, "YYYY-MM-DD". */
function chicagoDate(offsetDays: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function seed(): Promise<string> {
  const tomorrow = chicagoDate(1);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    await client.query(
      `TRUNCATE TABLE ${tables.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
    await client.query(`INSERT INTO "Setting" (id, "orderingEnabled") VALUES (1, true)`);
    const { rows: horn } = await client.query<{ id: string }>(
      `INSERT INTO "Product" (id, name, "unitPriceCents", "capacityMode", "roundG", "piecesPerRound", "sortOrder", "updatedAt")
       VALUES (gen_random_uuid(), '奶酪角', 299, 'DOUGH_PER_ROUND', 340, 4, 1, now()) RETURNING id`,
    );
    const { rows: brulee } = await client.query<{ id: string }>(
      `INSERT INTO "Product" (id, name, "unitPriceCents", "capacityMode", "dailyLimit", "batchYield", "leadDays", "sortOrder", "updatedAt")
       VALUES (gen_random_uuid(), '焦糖布蕾', 229, 'INDEPENDENT', 24, 3, 2, 2, now()) RETURNING id`,
    );
    await client.query(`INSERT INTO "OpenDate" (date, "updatedAt") VALUES ($1, now())`, [tomorrow]);
    const orders: [string, number, number][] = [
      ["NEW", 6, 10],
      ["CONFIRMED", 0, 10],
    ];
    let seq = 0;
    for (const [status, hornQty, bruleeQty] of orders) {
      seq += 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "Order" (id, "pickupDate", seq, "orderNo", "viewToken", "wechatId", fulfillment, status,
           "subtotalCents", "deliveryFeeCents", "totalCents", "cutoffAt", source, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PICKUP', $6, 1000, 0, 1000, now(), 'WEB', now())
         RETURNING id`,
        [tomorrow, seq, `E2E-00${seq}`, randomBytes(16).toString("hex"), `wx_e2e_${seq}`, status],
      );
      for (const [productId, name, qty] of [
        [horn[0].id, "奶酪角", hornQty],
        [brulee[0].id, "焦糖布蕾", bruleeQty],
      ] as const) {
        if (qty === 0) continue;
        await client.query(
          `INSERT INTO "OrderItem" (id, "orderId", "productId", "nameSnapshot", qty, "unitPriceCents", "bundleSize", "lineTotalCents")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 100, 4, 100)`,
          [rows[0].id, productId, name, qty],
        );
      }
    }
    const { rows: user } = await client.query<{ id: string }>(
      `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt")
       VALUES (gen_random_uuid(), 'e2e-dashboard-owner', 'not-a-real-hash', now()) RETURNING id`,
    );
    await client.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [tokenHash, user[0].id],
    );
  } finally {
    await client.end();
  }
  return token;
}

async function login(context: BrowserContext, baseURL: string): Promise<void> {
  const token = await seed();
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

test("dashboard shows the numbers and the unconfirmed reminder links to the filtered list", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin");

  const reminder = page.getByRole("link", { name: "明天还有 1 笔订单没确认" });
  await expect(reminder).toBeVisible();
  await expect(reminder).toHaveAttribute(
    "href",
    `/admin/orders?date=${chicagoDate(1)}&status=NEW&status=CONTACTED`,
  );

  const tomorrow = page.getByTestId("card-tomorrow");
  await expect(tomorrow).toContainText("奶酪角 6（做 2 个大圆包，多出 2 角）");
  await expect(tomorrow).toContainText("面团 680 / 1600 g");
  await expect(tomorrow).toContainText("焦糖布蕾 20 / 24");
  await expect(page.getByTestId("tonight")).toContainText("焦糖布蕾：20 杯 → 7 批，多出 1 杯");
  await expect(page.getByTestId("next14").getByRole("listitem")).toHaveCount(14);

  // No horizontal scroll at 320px either.
  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
});

test("pausing ordering asks for confirmation; turning it back on does not", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!);
  await page.goto("/admin");
  await expect(page.getByTestId("ordering-state")).toHaveText(t.orderingOn);

  // Cancel keeps ordering on.
  await page.getByRole("button", { name: t.turnOff }).click();
  const dialog = page.getByRole("dialog", { name: t.pauseConfirmTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: t.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("ordering-state")).toHaveText(t.orderingOn);

  // Confirm pauses.
  await page.getByRole("button", { name: t.turnOff }).click();
  await page.getByRole("dialog").getByRole("button", { name: t.pauseConfirmYes }).click();
  await expect(page.getByTestId("ordering-state")).toHaveText(t.orderingOff);
  await expect(page.getByRole("dialog")).toBeHidden();

  // Survives a reload (it was saved).
  await page.reload();
  await expect(page.getByTestId("ordering-state")).toHaveText(t.orderingOff);

  // Turning on needs no confirmation.
  await page.getByRole("button", { name: t.turnOn }).click();
  await expect(page.getByTestId("ordering-state")).toHaveText(t.orderingOn);
});
