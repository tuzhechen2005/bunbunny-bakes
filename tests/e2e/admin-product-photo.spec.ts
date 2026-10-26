// Product photos and colour e2e (T5.2, D95, D98): real backend, in-memory image store (dev server
// is not on Netlify). The server must run against a *_test database (local Playwright config).

import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { createAdminSession, resetAndSeed, type Seeded } from "./support/seed";

const t = copy.admin.products;
const SHOTS = "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens";

let seeded: Seeded;

test.beforeEach(async ({ context, baseURL }) => {
  seeded = await resetAndSeed({ openTomorrow: true });
  await context.addCookies([
    { name: "bb_session", value: await createAdminSession("e2e-photo-owner"), url: baseURL! },
  ]);
});

const tiles = (page: import("@playwright/test").Page) => page.getByTestId("photo-tile");
const noOverflow = async (page: import("@playwright/test").Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);

async function menuProduct(page: import("@playwright/test").Page, id: string) {
  const menu = await (await page.request.get("/api/menu")).json();
  return menu.products.find((p: { id: string }) => p.id === id);
}

test("upload two photos at once: cover badge on the first, resized, shown in the menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByRole("heading", { name: t.editTitle })).toBeVisible();
  await expect(page.getByTestId("photo-field").getByTestId("bunny-placeholder")).toBeVisible();
  await expect(page.getByTestId("photo-input")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await expect(page.getByTestId("photo-input")).toHaveAttribute("multiple", "");

  // A 2400x1800 photo is shrunk on the client before upload; the second file goes after it.
  await page.getByTestId("photo-input").setInputFiles(["tests/fixtures/bun-large.jpg", "tests/fixtures/bun.png"]);
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByTestId("photo-count")).toHaveText(t.photoCount.replace("{n}", "2"));
  await expect(page.getByTestId("photo-cover-badge")).toHaveCount(1);
  await expect(tiles(page).first().getByTestId("photo-cover-badge")).toBeVisible();
  const first = tiles(page).first().getByTestId("photo-preview");
  await expect(first).toHaveAttribute("src", /^\/api\/images\/[0-9a-f-]{36}\/[0-9a-f]{32}\.jpg$/);
  await expect
    .poll(() => first.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([1600, 1200]);
  await noOverflow(page);
  await page.screenshot({ path: `${SHOTS}/k1_data-photos.png`, fullPage: true });

  const product = await menuProduct(page, seeded.products.red);
  expect(product.images).toHaveLength(2);
  expect(product.imageUrl).toBe(product.images[0]);
});

test("reorder with the buttons and by dragging, delete with a confirmation, cover follows", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await page.getByTestId("photo-input").setInputFiles(["tests/fixtures/bun.jpg", "tests/fixtures/bun.png", "tests/fixtures/bun.webp"]);
  await expect(tiles(page)).toHaveCount(3);
  const ids = async () => tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-image-id")));
  const [a, b, c] = await ids();
  expect(new Set([a, b, c]).size).toBe(3);

  // 前移 / 后移 buttons
  await expect(tiles(page).first().getByTestId("photo-up")).toBeDisabled();
  await tiles(page).nth(0).getByTestId("photo-down").click();
  await expect.poll(ids).toEqual([b, a, c]);
  await expect(tiles(page).first().getByTestId("photo-cover-badge")).toBeVisible();
  expect((await menuProduct(page, seeded.products.red)).imageUrl).toBe(
    await tiles(page).first().getByTestId("photo-preview").getAttribute("src"),
  );

  // Drag the last tile's grip onto the first tile.
  const grip = tiles(page).nth(2).getByTestId("photo-grip");
  const from = (await grip.boundingBox())!;
  const to = (await tiles(page).nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(ids).toEqual([c, b, a]);
  await page.reload();
  await expect.poll(ids).toEqual([c, b, a]);
  await expect(tiles(page).first().getByTestId("photo-cover-badge")).toBeVisible();

  // Delete asks first.
  await tiles(page).nth(0).getByTestId("photo-delete").click();
  await expect(page.getByText(t.photoDeleteConfirm)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/k1_data-photo-confirm.png`, fullPage: true });
  await page.getByRole("button", { name: t.photoDeleteNo }).click();
  await expect(tiles(page)).toHaveCount(3);
  await tiles(page).nth(0).getByTestId("photo-delete").click();
  await page.getByTestId("photo-delete-yes").click();
  await expect(tiles(page)).toHaveCount(2);
  await expect.poll(ids).toEqual([b, a]);
  await expect(tiles(page).first().getByTestId("photo-cover-badge")).toBeVisible();
  const product = await menuProduct(page, seeded.products.red);
  expect(product.images).toHaveLength(2);

  // Delete everything: back to the bunny.
  for (const n of [2, 1]) {
    await tiles(page).first().getByTestId("photo-delete").click();
    await page.getByTestId("photo-delete-yes").click();
    await expect(tiles(page)).toHaveCount(n - 1);
  }
  await expect(page.getByTestId("photo-field").getByTestId("bunny-placeholder")).toBeVisible();
  expect((await menuProduct(page, seeded.products.red)).imageUrl).toBeNull();
});

test("the sixth photo is the last: the add button disables and extra files are refused with a message", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  const five = Array.from({ length: 5 }, () => "tests/fixtures/bun.jpg");
  await page.getByTestId("photo-input").setInputFiles(five);
  await expect(tiles(page)).toHaveCount(5);
  await page.getByTestId("photo-input").setInputFiles(["tests/fixtures/bun.jpg", "tests/fixtures/bun.png"]);
  await expect(tiles(page)).toHaveCount(6);
  await expect(page.getByTestId("photo-error")).toHaveText(t.photoLimit);
  await expect(page.getByTestId("photo-add")).toBeDisabled();
  await noOverflow(page);
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

test("pick a preset colour, a custom colour and see the warning; the menu follows", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await expect(page.getByTestId("color-field")).toBeVisible();
  // No colour stored (null): the default 奶白 is selected.
  await expect(page.getByTestId("color-swatch-EFE7DA")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("color-swatch-EFE7DA")).toBeVisible();
  expect((await page.getByTestId("color-field").locator('[role="radio"]').count())).toBe(10);

  await page.getByTestId("color-swatch-B9C9A0").click();
  await expect(page.getByTestId("color-swatch-B9C9A0")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("color-swatch-EFE7DA")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("color-preview")).toHaveCSS("background-color", "rgb(185, 201, 160)");
  await expect(page.getByTestId("color-warning")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/k1_data-colour.png`, fullPage: true });

  await page.getByTestId("color-custom").fill("#787878");
  await expect(page.getByTestId("color-hex")).toHaveText("#787878");
  await expect(page.getByTestId("color-warning")).toHaveCount(0); // black or white always reads (>= 4.58:1)
  await page.screenshot({ path: `${SHOTS}/k1_data-colour-warning.png`, fullPage: true });
  await noOverflow(page);

  await page.getByTestId("color-custom").fill("#336699");
  await expect(page.getByTestId("color-warning")).toHaveCount(0);
  await page.getByRole("button", { name: t.save, exact: true }).click();
  await expect(page.getByText(t.saved, { exact: true })).toBeVisible();
  const product = await menuProduct(page, seeded.products.red);
  expect(product.field.bg).toBe("#336699");
  expect(product.field.ink).toMatch(/^#[0-9A-F]{6}$/);

  await page.reload();
  await expect(page.getByTestId("color-hex")).toHaveText("#336699");
});

test("lead days show a 「需提前 N 天预订」 preview that follows the select", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  const select = page.locator('select[name="leadDays"]');
  await select.selectOption("3");
  await expect(page.getByText(t.leadDaysPreview.replace("{n}", "3"))).toBeVisible();
  await select.selectOption("1");
  await expect(page.getByText(t.leadDaysPreview.replace("{n}", "1"))).toBeVisible();
  await select.selectOption("0");
  await expect(page.getByText(t.leadDaysPreviewNone)).toBeVisible();
});

test("new product page shows the colour picker (default 奶白) and the photo hint", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/admin/products/new");
  await expect(page.getByTestId("color-swatch-EFE7DA")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(t.photoAfterSave)).toBeVisible();
  await noOverflow(page);
});

test("dragging the first photo to the LAST place is saved (mouse and CDP touch)", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await page.getByTestId("photo-input").setInputFiles(["tests/fixtures/bun.jpg", "tests/fixtures/bun.png", "tests/fixtures/bun.webp"]);
  await expect(tiles(page)).toHaveCount(3);
  const ids = async () => tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-image-id")));
  const [a, b, c] = await ids();

  const centre = async (i: number, grip = false) => {
    const box = (await (grip ? tiles(page).nth(i).getByTestId("photo-grip") : tiles(page).nth(i)).boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2] as const;
  };

  // mouse
  const [gx, gy] = await centre(0, true);
  const [tx, ty] = await centre(2);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
  await expect.poll(ids).toEqual([b, c, a]);
  await page.reload();
  await expect.poll(ids).toEqual([b, c, a]);

  // touch (CDP): the new first photo goes to the last place again
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x!, y: y! }] });
  const [sx, sy] = await centre(0, true);
  const [ex, ey] = await centre(2);
  await touch("touchStart", sx, sy);
  for (let i = 1; i <= 10; i++) await touch("touchMove", sx + ((ex - sx) * i) / 10, sy + ((ey - sy) * i) / 10);
  await touch("touchEnd");
  await expect.poll(ids).toEqual([c, a, b]);
  await page.reload();
  await expect.poll(ids).toEqual([c, a, b]);
});

test("a real upload shows on the home card through the image optimizer; deleting it brings the bunny back", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const home = page.getByTestId("product-card").filter({ hasText: "奶酥红豆包" });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await page.getByTestId("photo-input").setInputFiles("tests/fixtures/bun-large.jpg");
  await expect(tiles(page)).toHaveCount(1);

  await page.goto("/");
  await expect(home).toBeVisible();
  const img = home.locator("img");
  await expect(img).toHaveAttribute("src", /\/_next\/image\?url=%2Fapi%2Fimages%2F/);
  await expect(img).toHaveAttribute("loading", "lazy");
  await expect(home.getByTestId("bunny-placeholder")).toHaveCount(0);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

  await page.goto(`/admin/products/${seeded.products.red}`);
  await tiles(page).first().getByTestId("photo-delete").click();
  await expect(page.getByTestId("photo-delete-yes")).toBeFocused();
  await page.getByTestId("photo-delete-yes").click();
  await expect(tiles(page)).toHaveCount(0);
  await page.goto("/");
  await expect(home.getByTestId("bunny-placeholder")).toBeVisible();
  await expect(home.locator("img")).toHaveCount(0);
});

test("a small PNG is re-encoded as JPEG before upload (strips metadata)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/admin/products/${seeded.products.red}`);
  await page.getByTestId("photo-input").setInputFiles("tests/fixtures/bun.png");
  const preview = page.getByTestId("photo-preview");
  await expect(preview).toHaveAttribute("src", /\.jpg$/);
  const res = await page.request.get((await preview.getAttribute("src"))!);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
});
