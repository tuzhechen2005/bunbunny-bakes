// Admin calendar e2e (dev server against the *_test database; see admin-shell.spec.ts).

import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";

const t = copy.admin.calendar;

function nextMonth15(): string {
  // Approximate Chicago "now" (UTC-6) to pick the month the page shows first.
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  const y = d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0);
  const m = ((d.getUTCMonth() + 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-15`;
}

async function seed(date: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const c = new Client({ connectionString: testDatabaseUrl() });
  await c.connect();
  try {
    await c.query(`TRUNCATE "OrderItem","Order","OpenDateProductLimit","OpenDate","Product","AuditLog" CASCADE`);
    await c.query(`INSERT INTO "Setting" (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await c.query(
      `INSERT INTO "Product" (id,name,"unitPriceCents","capacityMode","doughG","updatedAt")
       VALUES (gen_random_uuid(),'红豆包',249,'DOUGH_PER_UNIT',70,now())`,
    );
    await c.query(
      `INSERT INTO "Product" (id,name,"unitPriceCents","capacityMode","dailyLimit","updatedAt")
       VALUES (gen_random_uuid(),'焦糖布蕾',249,'INDEPENDENT',24,now())`,
    );
    await c.query(`INSERT INTO "OpenDate" ("date") VALUES ($1::date)`, [date]);
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM "Product" WHERE name='红豆包'`);
    const o = await c.query<{ id: string }>(
      `INSERT INTO "Order" (id,"pickupDate",seq,"orderNo","viewToken","wechatId",fulfillment,status,"subtotalCents","deliveryFeeCents","totalCents","cutoffAt",source,"updatedAt")
       VALUES (gen_random_uuid(),$1::date,1,'X-001',$2,'wx','PICKUP','NEW',2490,0,2490,now(),'WEB',now()) RETURNING id`,
      [date, randomBytes(16).toString("hex")],
    );
    await c.query(
      `INSERT INTO "OrderItem" (id,"orderId","productId","nameSnapshot",qty,"unitPriceCents","bundleSize","lineTotalCents")
       VALUES (gen_random_uuid(),$1,$2,'红豆包',10,249,4,2490)`,
      [o.rows[0].id, rows[0].id],
    );
    const u = await c.query<{ id: string }>(
      `INSERT INTO "AdminUser" (id, username, "passwordHash", "updatedAt")
       VALUES (gen_random_uuid(), 'e2e-cal-owner', 'x', now())
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    );
    await c.query(
      `INSERT INTO "AdminSession" (id, "tokenHash", "userId", "createdAt", "expiresAt", "lastSeenAt")
       VALUES (gen_random_uuid(), $1, $2, now(), now() + interval '1 day', now())`,
      [tokenHash, u.rows[0].id],
    );
  } finally {
    await c.end();
  }
  return token;
}

test("open a day, change the dough limit, hit a warning and confirm", async ({ page, context, baseURL }, info) => {
  const date = nextMonth15();
  const token = await seed(date);
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL! }]);

  await page.goto("/admin/calendar");
  await page.getByRole("button", { name: t.nextMonth }).click();
  const cell = page.locator(`[data-date="${date}"]`);
  await expect(cell).toContainText("700 / 1600 g");
  await page.screenshot({ path: "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/m5a-calendar.png", fullPage: true });

  // Plain change: dough limit 1200, saved.
  await cell.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(t.doughLimit).fill("1200");
  await dialog.getByRole("button", { name: t.save, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(cell).toContainText("700 / 1200 g");

  // Warning: limit below the 700 g in use.
  await cell.click();
  await dialog.getByLabel(t.doughLimit).fill("500");
  await dialog.getByRole("button", { name: t.save, exact: true }).click();
  await expect(dialog.getByText("面团上限 500 g，但这天已用 700 g")).toBeVisible();
  await expect(cell).toContainText("700 / 1200 g"); // nothing written yet
  await dialog.getByRole("button", { name: t.saveAnyway }).click();
  await expect(dialog).toBeHidden();
  await expect(cell).toContainText("700 / 500 g");
  await expect(cell).toHaveAttribute("data-over", "true");

  // Un-tick a day with orders: warning text from PAGES.md.
  await cell.click();
  await dialog.getByLabel(t.isOpen).uncheck();
  await dialog.getByRole("button", { name: t.save, exact: true }).click();
  await expect(dialog.getByText("这天已有 1 笔订单，取消开放不会取消这些订单，只是不能再下新单")).toBeVisible();
  void info;
});
