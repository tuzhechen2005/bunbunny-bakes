// Product photo upload e2e (T5.2): real backend, in-memory image store (dev server is not
// on Netlify). The dev server must run against a *_test database (local Playwright config).

import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, resetAndSeed, type Seeded } from "./support/seed";

const t = copy.admin.products;
const SCREENSHOT = "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/t5.2-photo.png";
const NAME = "奶酥红豆包";

let seeded: Seeded;

test.beforeEach(async ({ context, baseURL }) => {
  seeded = await resetAndSeed({ openTomorrow: true });
  await context.addCookies([
    { name: "bb_session", value: await createAdminSession("e2e-photo-owner"), url: baseURL! },
  ]);
});

test("upload a (large) photo, see it on the home card, then delete it back to the bunny", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const home = page.getByTestId("product-card").filter({ hasText: NAME });

  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByRole("heading", { name: t.editTitle })).toBeVisible();
  await expect(page.getByTestId("photo-field").getByTestId("bunny-placeholder")).toBeVisible();
  await expect(page.getByRole("button", { name: t.photoDelete })).toHaveCount(0);
  await expect(page.getByTestId("photo-input")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");

  // A 2400x1800 photo is shrunk on the client before upload.
  const uploaded = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/products/${seeded.products.red}/image`) && r.request().method() === "POST",
  );
  await page.getByTestId("photo-input").setInputFiles("tests/fixtures/bun-large.jpg");
  expect((await uploaded).status()).toBe(200);

  const preview = page.getByTestId("photo-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^\/api\/images\/[0-9a-f-]{36}\/[0-9a-f]{32}\.jpg$/);
  await expect(page.getByRole("button", { name: t.photoDelete })).toBeVisible();
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([1600, 1200]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: SCREENSHOT, fullPage: false });

  // Customer side: the card shows the photo, not the bunny.
  await page.goto("/");
  await expect(home).toBeVisible();
  const img = home.locator("img");
  // Served resized by the image optimizer (D91).
  await expect(img).toHaveAttribute("src", /\/_next\/image\?url=%2Fapi%2Fimages%2F/);
  await expect(img).toHaveAttribute("loading", "lazy");
  await expect(home.getByTestId("bunny-placeholder")).toHaveCount(0);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  // Delete returns to the bunny.
  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByTestId("photo-preview")).toBeVisible();
  await page.getByRole("button", { name: t.photoDelete }).click();
  await expect(page.getByTestId("photo-field").getByTestId("bunny-placeholder")).toBeVisible();
  await page.goto("/");
  await expect(home.getByTestId("bunny-placeholder")).toBeVisible();
  await expect(home.locator("img")).toHaveCount(0);
});

test("a small PNG is re-encoded as JPEG before upload (strips metadata)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByTestId("photo-input")).toBeAttached();
  await page.getByTestId("photo-input").setInputFiles("tests/fixtures/bun.png");
  await expect(page.getByTestId("photo-preview")).toHaveAttribute("src", /\.jpg$/);
  const src = await page.getByTestId("photo-preview").getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
});

test("a non-image file is refused with a Chinese message", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByTestId("photo-input")).toBeAttached();
  await page.getByTestId("photo-input").setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html>not an image</html>"),
  });
  await expect(page.getByTestId("photo-error")).toBeVisible();
  await expect(page.getByTestId("photo-field").getByTestId("bunny-placeholder")).toBeVisible();
});
