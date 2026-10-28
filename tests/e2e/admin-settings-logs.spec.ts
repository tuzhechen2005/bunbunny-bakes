// Admin settings + logs e2e. The dev server must run against the *_test database
// (the local Playwright config sets DATABASE_URL); this spec seeds an admin, a session
// and the Setting row there.

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";
import { screensDir } from "./support/screensDir";

const t = copy.admin.settings;
const l = copy.admin.logs;
const USERNAME = "e2e-settings-owner";
const SCREENS = screensDir();

// Plain SQL: Playwright's CommonJS loader cannot import the generated Prisma client.
async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seed(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await withDb(async (client) => {
    await client.query(`DELETE FROM "AuditLog"`);
    await client.query(`DELETE FROM "Setting"`);
    await client.query(`INSERT INTO "Setting" (id, "ownerWechatId", "updatedAt") VALUES (1, 'bunny_owner', now())`);
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
    // Older entries so the logs screenshot has some company (a date change with a reason).
    await client.query(
      `INSERT INTO "AuditLog" (id, at, actor, action, "entityType", "entityId", before, after, reason)
       VALUES (gen_random_uuid(), now() - interval '2 hours', 'ADMIN', 'date.update', 'OpenDate', '2026-10-30',
               '{"doughLimitG":1600}', '{"doughLimitG":1200}', '烤箱坏了，少做一点')`,
    );
  });
  return token;
}

async function loginAsAdmin(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: "bb_session", value: await seed(), url: baseURL }]);
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

test("changing the pickup note persists and shows up in the logs", async ({ page, context, baseURL }) => {
  await loginAsAdmin(context, baseURL!);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: t.title })).toBeVisible();

  const note = `自提改到下午 6 点以后 ${Date.now() % 10000}`;
  const noteBox = page.getByLabel(t.texts.pickupNote);
  await expect(noteBox).not.toHaveValue("");
  await noteBox.fill(note);

  await page.getByRole("button", { name: t.save }).nth(4).click(); // 文案 section
  await expect(page.getByText(t.saved)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(t.texts.pickupNote)).toHaveValue(note);

  await page.goto("/admin/logs");
  await expect(page.getByRole("heading", { name: l.title })).toBeVisible();
  const entry = page.getByTestId("log-entry").first();
  await expect(entry).toContainText(l.actions["settings.update"]);
  await expect(entry).toContainText(l.fields.pickupNote);
  await expect(entry).toContainText(note);
  await expect(entry).not.toContainText(l.fields.cutoffTime);
});

test("a cutoff time inside the DST window is refused client-side", async ({ page, context, baseURL }) => {
  await loginAsAdmin(context, baseURL!);
  await page.goto("/admin/settings");
  await page.getByLabel(t.rules.cutoffTime).fill("02:00");
  await page.getByRole("button", { name: t.save }).first().click();
  await expect(page.getByText(t.cutoffTimeInvalid).first()).toBeVisible();
});

test("search by an unknown order number shows the empty state", async ({ page, context, baseURL }) => {
  await loginAsAdmin(context, baseURL!);
  await page.goto("/admin/logs");
  await expect(page.getByTestId("log-entry").first()).toBeVisible();
  await page.getByRole("searchbox", { name: l.searchLabel }).fill("0101-999");
  await page.getByRole("button", { name: l.search, exact: true }).click();
  await expect(page.getByText(l.empty)).toBeVisible();
});

test("both pages fit a 320px screen, and screenshots at 375px", async ({ page, context, baseURL }) => {
  await loginAsAdmin(context, baseURL!);

  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/admin/settings", "/admin/logs"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(t.loading)).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/settings");
  await expect(page.getByLabel(t.texts.pickupNote)).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/m5c-settings.png`, fullPage: true });
  await page.goto("/admin/logs");
  await expect(page.getByTestId("log-entry").first()).toBeVisible();
  await page.screenshot({ path: `${SCREENS}/m5c-logs.png`, fullPage: true });
});
