// Admin shell e2e. The dev server must run against the *_test database (the local
// Playwright config sets DATABASE_URL); this spec seeds an admin + session there.

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { copy } from "../../src/copy";
import { testDatabaseUrl } from "../db/testDbUrl";

const t = copy.admin.shell;
const USERNAME = "e2e-shell-owner";

// Plain SQL: Playwright's CommonJS loader cannot import the generated Prisma client.
async function createAdminSession(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
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
  } finally {
    await client.end();
  }
  return token;
}

async function loginAsAdmin(context: BrowserContext, baseURL: string): Promise<void> {
  const token = await createAdminSession();
  await context.addCookies([{ name: "bb_session", value: token, url: baseURL }]);
}

test("unauthenticated /admin redirects to the login page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: copy.admin.auth.loginTitle })).toBeVisible();
});

test("a logged-in admin sees the shell, the menu links, and can log out", async ({ page, context, baseURL }) => {
  await loginAsAdmin(context, baseURL!);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: t.dashboardTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.customer.brand.brandName })).toBeVisible();
  for (const label of [t.orders, t.calendar, t.newOrder, t.products, t.settings]) {
    await expect(page.getByRole("main").getByRole("link", { name: label })).toBeVisible();
  }

  await page.getByRole("button", { name: t.openMenu }).click();
  const nav = page.getByRole("navigation", { name: t.mainNav });
  const expected: Record<string, string> = {
    [t.orders]: "/admin/orders",
    [t.calendar]: "/admin/calendar",
    [t.newOrder]: "/admin/orders/new",
    [t.products]: "/admin/products",
    [t.settings]: "/admin/settings",
    [t.logs]: "/admin/logs",
  };
  for (const [label, href] of Object.entries(expected)) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }
  await expect(nav.getByRole("button", { name: t.logout })).toBeVisible();

  await nav.getByRole("button", { name: t.logout }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);

  // The session is gone: /admin sends us back to the login page.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
