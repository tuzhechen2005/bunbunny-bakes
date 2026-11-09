// 帮我选 (owner 11/06): spins among the breads on sale, stops on one, opens its detail; Back and × close it.
import { expect, test, type Page } from "@playwright/test";

const product = (id: string, name: string, status = "ACTIVE") => ({
  id, name, description: "", imageUrl: null, images: [], isNew: false, unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899,
  status, leadDays: 1, pickupWeekdays: [], field: { bg: "#e8b84b", ink: "#3a2a12", ink2: "#6b5430" },
});

async function mock(page: Page, products: unknown[]) {
  await page.route("**/api/menu", (r) =>
    r.fulfill({ json: { orderingEnabled: true, products, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 } }),
  );
}

test.use({ reducedMotion: "reduce" });

test.describe("bread picker", () => {
  test("never picks a paused bread, re-spins to another, and opens the detail of the pick", async ({ page }) => {
    await mock(page, [product("a", "红豆包"), product("b", "奶酪角"), product("c", "停售包", "PAUSED")]);
    await page.goto("/");
    const seen = new Set<string>();
    await page.getByTestId("picker-open").click();
    await expect(page.getByTestId("picker-stamp")).toBeVisible();
    for (let i = 0; i < 6; i++) {
      const before = await page.getByTestId("picker-name").textContent();
      seen.add(before!);
      await page.getByTestId("picker-again").click();
      await expect(page.getByTestId("picker-name")).not.toHaveText(before!);
    }
    expect([...seen].sort()).toEqual(["奶酪角", "红豆包"].sort());
    const name = (await page.getByTestId("picker-name").textContent())!;
    await page.getByTestId("picker-view").click();
    await expect(page.getByTestId("picker")).toHaveCount(0);
    await expect(page.locator(".hm-detail")).toBeVisible();
    await expect(page.locator(".hm-detail")).toContainText(name);
    // Back closes the detail and stays on the page: the picker's own history entry is gone.
    await page.goBack();
    await expect(page.locator(".hm-detail")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("hero")).toBeVisible();
  });

  test("× and Back close it without leaving the page", async ({ page }) => {
    await mock(page, [product("a", "红豆包"), product("b", "奶酪角")]);
    await page.goto("/");
    await page.getByTestId("picker-open").click();
    await page.getByTestId("picker-close").click();
    await expect(page.getByTestId("picker")).toHaveCount(0);
    await page.getByTestId("picker-open").click();
    await expect(page.getByTestId("picker")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("picker")).toHaveCount(0);
    await expect(page.getByTestId("hero")).toBeVisible();
  });

  test("is not offered with fewer than two breads on sale", async ({ page }) => {
    await mock(page, [product("a", "红豆包"), product("c", "停售包", "PAUSED")]);
    await page.goto("/");
    await expect(page.getByTestId("hero")).toBeVisible();
    await expect(page.getByTestId("picker-open")).toBeHidden();
  });
});
