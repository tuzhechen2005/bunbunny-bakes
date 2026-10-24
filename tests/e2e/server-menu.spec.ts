// The home page rendered with the menu from the server (D91, src/server/menuCache.ts): the path production
// runs. The normal suite starts the server with HOME_INITIAL_MENU=off (its specs mock /api/menu), so this
// spec only runs when the server was started without that flag:
//
//   E2E_SERVER_MENU=1 TEST_DATABASE_URL=... npx playwright test -c playwright.local.config.ts tests/e2e/server-menu.spec.ts
//
// (E2E_SERVER_MENU=1 makes playwright.config.ts leave HOME_INITIAL_MENU unset; run only this file with it.)
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, resetAndSeed, type Seeded } from "./support/seed";

test.skip(!process.env.E2E_SERVER_MENU, "needs the server started without HOME_INITIAL_MENU=off (E2E_SERVER_MENU=1)");
test.use({ browserName: "chromium" });

const NAMES = { red: "奶酥红豆包", cheeseRock: "岩烧乳酪包", wedge: "奶酪角", brulee: "焦糖布蕾" };

let seeded: Seeded;

test.beforeEach(async ({ context, baseURL }) => {
  seeded = await resetAndSeed({ openTomorrow: true });
  await context.addCookies([{ name: "bb_session", value: await createAdminSession("e2e-server-menu"), url: baseURL! }]);
});

/** An admin write (also what drops the server's cached menu). */
async function admin(page: Page, path: string, data: unknown, baseURL: string | undefined) {
  const res = await page.request.post(path, { data, headers: { origin: baseURL! } });
  expect(res.status(), path).toBe(200);
}

const ropeNames = (page: Page) => page.locator(".hm-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
const currentName = (page: Page) => page.getByTestId("current-name").locator("span:not([aria-hidden])");

/** Every card is placed by the rack (inline transform) and the centred one is fully visible and is the one named below. */
async function expectPlacedAndCentred(page: Page) {
  const centred = page.locator('.hm-card[aria-selected="true"]');
  await expect(centred).toHaveCount(1);
  await expect(centred).toHaveCSS("opacity", "1");
  await expect.poll(() => page.locator(".hm-card").evaluateAll((els) => els.every((e) => (e as HTMLElement).style.transform !== ""))).toBe(true);
  await expect(currentName(page)).toHaveText((await centred.getAttribute("aria-label"))!);
}

test("(a) /api/menu unreachable: rope and grid come from the server copy, cards visible, centred card = current name", async ({ page, baseURL }) => {
  await admin(page, "/api/admin/ordering", { enabled: true }, baseURL); // drops anything cached from earlier runs
  await page.route("**/api/menu", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByTestId("rack")).toBeVisible();
  expect(await ropeNames(page)).toEqual([NAMES.red, NAMES.cheeseRock, NAMES.wedge, NAMES.brulee]);
  await expect(page.getByTestId("product-card")).toHaveCount(4);
  await expectPlacedAndCentred(page);
  await expect(page.getByText(copy.customer.home.loadFailed)).toHaveCount(0);
});

test("(b) the client refetch brings another order or other products: the rack is rebuilt, placed and centred", async ({ page, baseURL }) => {
  await admin(page, "/api/admin/ordering", { enabled: true }, baseURL);

  // Same length, other order.
  await page.route("**/api/menu", async (route) => {
    const res = await route.fetch();
    const menu = await res.json();
    menu.products.reverse();
    await route.fulfill({ response: res, json: menu });
  });
  await page.goto("/");
  await expect.poll(() => ropeNames(page)).toEqual([NAMES.brulee, NAMES.wedge, NAMES.cheeseRock, NAMES.red]);
  await expectPlacedAndCentred(page);
  await expect(currentName(page)).toHaveText(NAMES.brulee);

  // Same length, one product swapped for another (new id).
  await page.unroute("**/api/menu");
  await page.route("**/api/menu", async (route) => {
    const res = await route.fetch();
    const menu = await res.json();
    menu.products[3] = { ...menu.products[3], id: "00000000-0000-4000-8000-000000000009", name: "新品面包" };
    await route.fulfill({ response: res, json: menu });
  });
  await page.goto("/");
  await expect.poll(() => ropeNames(page)).toEqual([NAMES.red, NAMES.cheeseRock, NAMES.wedge, "新品面包"]);
  await expectPlacedAndCentred(page);
});

test("(b2) an admin reorder shows on the next load, from the server copy", async ({ page, baseURL }) => {
  const { red, cheeseRock, wedge, brulee } = seeded.products;
  await admin(page, "/api/admin/products/reorder", { ids: [brulee, wedge, cheeseRock, red] }, baseURL);
  await page.route("**/api/menu", (route) => route.abort());
  await page.goto("/");
  await expect.poll(() => ropeNames(page)).toEqual([NAMES.brulee, NAMES.wedge, NAMES.cheeseRock, NAMES.red]);
  await expectPlacedAndCentred(page);
});

test("(c) closing ordering is on the server copy at once (the cache is dropped by the admin write)", async ({ page, baseURL }) => {
  await page.route("**/api/menu", (route) => route.abort());
  await admin(page, "/api/admin/ordering", { enabled: true }, baseURL);
  await page.goto("/");
  await expect(page.getByTestId("rack")).toBeVisible(); // the open copy is now cached
  await expect(page.getByText(copy.home.orderingClosed)).toHaveCount(0);

  await admin(page, "/api/admin/ordering", { enabled: false }, baseURL);
  await page.goto("/");
  await expect(page.getByText(copy.home.orderingClosed)).toBeVisible();
});
