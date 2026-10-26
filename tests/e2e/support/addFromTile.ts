// The only way to put bread in the bag is the detail (D97): open it from a list tile, pick the
// quantity, 放进纸袋, hang the detail back.
import { expect, type Page } from "@playwright/test";

export const tileOf = (page: Page, id: string) => page.locator(`[data-testid="product-card"][data-product-id="${id}"]`);

/** Opens the detail of a list tile and waits until it is there. */
export async function openTile(page: Page, id: string) {
  await tileOf(page, id).getByTestId("tile-photo").click();
  await expect(page.getByTestId("detail")).toBeVisible({ timeout: 4000 });
}

/** Hangs the open detail back (Esc) and waits until it is gone. */
export async function closeDetail(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 4000 });
}

/** Puts `qty` of a product in the bag in one go from its detail (one flight carrying `qty`). */
export async function addFromTile(page: Page, id: string, qty = 1) {
  await openTile(page, id);
  for (let i = 1; i < qty; i++) await page.getByTestId("detail-inc").click();
  await page.getByTestId("detail-add").click();
  await closeDetail(page);
}
