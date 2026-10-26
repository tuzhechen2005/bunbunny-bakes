// K2: the detail photo carousel (D98), the second photo on the back of the spin, the narrow header,
// and the lead hints (D96). Gestures use real touch events through CDP (Chromium only), like rack.spec.ts.
// Menu answers are mocked with the shared contract: `images` (cover first) and `field` per product.
import { readFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { openTile } from "./support/addFromTile";
import { drag, finger, type Finger } from "./support/touch";

test.use({ browserName: "chromium" });

const PHOTO = readFileSync("tests/fixtures/bun.jpg");
const MOCK_PHOTO = /\/api\/images\/mock\/|%2Fapi%2Fimages%2Fmock%2F/;
const SHOTS = process.env.K2_SHOTS; // a folder: also save the screenshots the task asks for

const COUNTS: Record<string, number> = { "p-red": 2, "p-rock": 3, "p-brulee": 1, "p-wedge": 0 };
const PRODUCTS = [
  { id: "p-red", name: "奶酥红豆包", leadDays: 1, status: "ACTIVE" },
  { id: "p-rock", name: "岩烧乳酪包", leadDays: 2, status: "ACTIVE" },
  { id: "p-brulee", name: "焦糖布蕾", leadDays: 3, status: "ACTIVE" },
  { id: "p-wedge", name: "奶酪角", leadDays: 1, status: "ACTIVE" },
].map((p) => {
  const images = Array.from({ length: COUNTS[p.id] }, (_, k) => `/api/images/mock/${p.id}-${k + 1}.jpg`);
  return {
    ...p,
    description: "简介",
    unitPriceCents: 249,
    bundleSize: 4,
    bundlePriceCents: 899,
    images,
    imageUrl: images[0] ?? null,
    field: { bg: "#DCC5BB", ink: "#4A2723", ink2: "#674741" },
  };
});

async function mockHome(page: Page, opts: { orderingEnabled?: boolean } = {}) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: {
        orderingEnabled: opts.orderingEnabled ?? true,
        products: PRODUCTS,
        pickupNote: "",
        deliveryFeeCents: 500,
        freeDeliveryMinCents: 2500,
        maxQtyPerItem: 8,
      },
    }),
  );
  await page.route(MOCK_PHOTO, (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
}

async function openHome(page: Page, opts: { orderingEnabled?: boolean } = {}) {
  await mockHome(page, opts);
  await page.goto("/");
  await expect(page.getByTestId("rack")).toBeVisible();
  await expect(page.getByTestId("product-card")).toHaveCount(4);
}

/** Opens a product's detail from its list tile and waits until the photo has landed (the FLIP is over). */
async function openDetail(page: Page, id: string) {
  await openTile(page, id);
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".hm-dt-ph")!.getAnimations().length), { timeout: 4000 })
    .toBe(0);
}

const photosEl = (page: Page) => page.getByTestId("detail-photos");
const photoIndex = async (page: Page) => Number(await photosEl(page).getAttribute("data-photo-index"));
/** Track offset in photo widths (0 = first photo, -1 = second). */
const trackAt = (page: Page) =>
  page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(".hm-dt-ph .hm-track")!;
    const w = track.parentElement!.clientWidth;
    return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 / w;
  });
const centreOfPhoto = async (page: Page): Promise<[number, number]> => {
  const b = (await photosEl(page).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};

async function touch(page: Page): Promise<{ cdp: CDPSession; f: Finger }> {
  const cdp = await page.context().newCDPSession(page);
  return { cdp, f: finger(cdp) };
}

test.describe("detail photo carousel (D98)", () => {
  test("a horizontal swipe switches the photo, with dots; the end rubber-bands; the product never changes", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    await expect(page.getByTestId("detail-dots").locator("i")).toHaveCount(2);
    await expect(page.getByTestId("detail-dots").locator("i.is-on")).toHaveCount(1);
    expect(await photoIndex(page)).toBe(0);
    expect(await trackAt(page)).toBeCloseTo(0, 2);
    const { f } = await touch(page);
    const [cx, cy] = await centreOfPhoto(page);

    await drag(f, [cx + 100, cy], [cx - 100, cy], { steps: 8, ms: 200, hold: 120 });
    await expect.poll(() => photoIndex(page)).toBe(1);
    await expect.poll(() => trackAt(page)).toBeCloseTo(-1, 2); // a spring settles on the snap point
    await expect(page.getByTestId("detail-dots").locator("i").nth(1)).toHaveClass(/is-on/);
    await expect(page.getByTestId("detail-name")).toHaveText("奶酥红豆包");
    await expect(page.getByTestId("detail-pos")).toHaveText("1 / 4");
    await expect(page.getByRole("status").filter({ hasText: "第 2 / 2 张" })).toHaveCount(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/k2_customer-detail-carousel.png` });

    // past the last photo: the finger drags it only a fraction of the way, and it springs back
    await drag(f, [cx + 100, cy], [cx - 60, cy], { steps: 8, ms: 200, hold: 120, release: false });
    const stretched = await trackAt(page);
    expect(stretched).toBeLessThan(-1.02);
    expect(stretched).toBeGreaterThan(-1.45); // the rubber band caps the overshoot at 0.45 of a photo
    await f.up();
    await expect.poll(() => trackAt(page)).toBeCloseTo(-1, 2);
    expect(await photoIndex(page)).toBe(1);

    // and back, a swipe to the right
    await drag(f, [cx - 100, cy], [cx + 100, cy], { steps: 8, ms: 200, hold: 120 });
    await expect.poll(() => photoIndex(page)).toBe(0);
    await expect.poll(() => trackAt(page)).toBeCloseTo(0, 2);
    // the first photo has nothing before it
    await drag(f, [cx - 40, cy], [cx + 90, cy], { steps: 8, ms: 200, hold: 120 });
    await expect.poll(() => trackAt(page)).toBeCloseTo(0, 2);
    expect(await photoIndex(page)).toBe(0);
    await expect(page.getByTestId("detail-name")).toHaveText("奶酥红豆包");
  });

  test("a fast flick moves exactly one photo, however long", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-rock");
    await expect(page.getByTestId("detail-dots").locator("i")).toHaveCount(3);
    const { f } = await touch(page);
    const [cx, cy] = await centreOfPhoto(page);
    await drag(f, [cx + 120, cy], [cx - 120, cy], { steps: 6, ms: 60 });
    await expect.poll(() => trackAt(page)).toBeCloseTo(-1, 2);
    expect(await photoIndex(page)).toBe(1);
  });

  test("axis is decided on the first move: vertical pulls the detail down, horizontal switches the photo", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    const { f } = await touch(page);
    const [cx, cy] = await centreOfPhoto(page);
    // mostly horizontal with a downward drift: the carousel keeps it, the detail stays
    await drag(f, [cx + 100, cy - 40], [cx - 100, cy + 40], { steps: 8, ms: 200, hold: 120 });
    await expect.poll(() => photoIndex(page)).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.getByTestId("detail")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector<HTMLElement>(".hm-dt-ph")!.style.transform)).toBe("");
    // mostly vertical with a little sideways wobble: the pull takes it, the photo stays where it was
    const [px, py] = await centreOfPhoto(page);
    await drag(f, [px, py - 100], [px + 14, py + 60], { steps: 10, ms: 200 });
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator(".hm-card.is-taken")).toHaveCount(0);
  });

  test("every touchmove of a claimed swipe is cancelled, so the page and the host app do not take it", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    const moves: { prevented: boolean; cancelable: boolean }[] = [];
    await page.exposeFunction("__tm", (prevented: boolean, cancelable: boolean) => moves.push({ prevented, cancelable }));
    await page.evaluate(() =>
      window.addEventListener("touchmove", (e) => (window as unknown as { __tm: (a: boolean, b: boolean) => void }).__tm(e.defaultPrevented, e.cancelable), {
        passive: true,
      }),
    );
    const { f } = await touch(page);
    const [cx, cy] = await centreOfPhoto(page);
    await drag(f, [cx + 60, cy], [cx - 60, cy], { steps: 10, ms: 200 });
    await expect.poll(() => photoIndex(page)).toBe(1);
    expect(moves.length).toBeGreaterThanOrEqual(8);
    expect(moves.slice(2).every((m) => m.prevented)).toBe(true);
  });

  test("keyboard: left / right on the focused photo; never leaves the product", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-rock");
    const photos = photosEl(page);
    await expect(photos).toHaveAttribute("tabindex", "0");
    await expect(photos).toHaveAttribute("role", "group");
    await expect(photos).toHaveAttribute("aria-label", "岩烧乳酪包 的照片，左右键切换");
    await photos.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => photoIndex(page)).toBe(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // clamped at the last of 3
    await expect.poll(() => photoIndex(page)).toBe(2);
    await expect.poll(() => trackAt(page)).toBeCloseTo(-2, 2);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => photoIndex(page)).toBe(1);
    await expect(page.getByTestId("detail-name")).toHaveText("岩烧乳酪包");
    await expect(page.getByTestId("detail-pos")).toHaveText("2 / 4");
  });

  test("one photo or none: no dots, not focusable, nothing to swipe", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-brulee"); // 1 photo
    await expect(page.getByTestId("detail-dots")).toHaveCount(0);
    await expect(page.getByTestId("detail-slide")).toHaveCount(1);
    await expect(photosEl(page)).not.toHaveAttribute("tabindex", /.*/);
    const { f } = await touch(page);
    const [cx, cy] = await centreOfPhoto(page);
    await drag(f, [cx + 60, cy], [cx - 60, cy], { steps: 8, ms: 160, hold: 120 });
    expect(await trackAt(page)).toBeCloseTo(0, 3);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });

    await openDetail(page, "p-wedge"); // none: the faint-logo tile
    await expect(page.getByTestId("detail-dots")).toHaveCount(0);
    await expect(page.getByTestId("detail").getByTestId("bunny-placeholder")).toBeVisible();
  });

  test("a new product starts on its cover; the cover is eager, the rest lazy", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    const slides = page.getByTestId("detail-slide");
    await expect(slides.nth(0).locator("img")).toHaveAttribute("loading", "eager");
    await expect(slides.nth(1).locator("img")).toHaveAttribute("loading", "lazy");
    expect(decodeURIComponent((await slides.nth(1).locator("img").getAttribute("src"))!)).toContain("p-red-2.jpg");
    await photosEl(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => photoIndex(page)).toBe(1);
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-name")).toHaveText("岩烧乳酪包");
    await expect.poll(() => photoIndex(page)).toBe(0);
    await expect.poll(() => trackAt(page)).toBeCloseTo(0, 2);
    await expect(page.getByTestId("detail-dots").locator("i")).toHaveCount(3);
    await page.getByTestId("detail-prev").click();
    await expect(page.getByTestId("detail-name")).toHaveText("奶酥红豆包");
    expect(await photoIndex(page)).toBe(0);
  });

  test("hanging back from the second photo works: nothing stays hidden on the rope", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    await photosEl(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => trackAt(page)).toBeCloseTo(-1, 2);
    await page.getByTestId("detail-close").click();
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator(".hm-card.is-taken")).toHaveCount(0);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("a swipe switches at once: no follow, no spring", async ({ page }) => {
      await openHome(page);
      await openTile(page, "p-red");
      const { f } = await touch(page);
      const [cx, cy] = await centreOfPhoto(page);
      // a short drag does nothing
      await drag(f, [cx + 10, cy], [cx - 5, cy], { steps: 4, ms: 120, hold: 120 });
      expect(await photoIndex(page)).toBe(0);
      expect(await trackAt(page)).toBeCloseTo(0, 3);
      // the finger does not drag the photo along ...
      await drag(f, [cx + 100, cy], [cx - 100, cy], { steps: 6, ms: 200, hold: 120, release: false });
      expect(await trackAt(page)).toBeCloseTo(0, 3);
      await f.up();
      // ... it jumps to the next one
      await expect.poll(() => photoIndex(page)).toBe(1);
      await expect.poll(() => trackAt(page), { timeout: 600 }).toBeCloseTo(-1, 3);
      expect(await page.evaluate(() => document.querySelector(".hm-track")!.getAnimations().length)).toBe(0);
      await expect(page.getByTestId("detail-name")).toHaveText("奶酥红豆包");
    });
  });
});

test.describe("rope: the back of the spin (D98)", () => {
  test("shows the second photo when there is one, else the (darker) cover", async ({ page }) => {
    await openHome(page);
    const backs = page.getByTestId("rack-back");
    await expect(backs).toHaveCount(4);
    const src = (i: number) => backs.nth(i).locator("img").getAttribute("src");
    await expect(backs.nth(0)).toHaveAttribute("data-second", "");
    expect(decodeURIComponent((await src(0))!)).toContain("p-red-2.jpg");
    await expect(backs.nth(1)).toHaveAttribute("data-second", "");
    expect(decodeURIComponent((await src(1))!)).toContain("p-rock-2.jpg");
    await expect(backs.nth(2)).not.toHaveAttribute("data-second", /.*/);
    expect(decodeURIComponent((await src(2))!)).toContain("p-brulee-1.jpg");
    await expect(backs.nth(3).getByTestId("bunny-placeholder")).toBeVisible();
    // the front stays the cover
    const front = page.locator('.hm-card[data-card="0"] .hm-face:not(.hm-back) img');
    expect(decodeURIComponent((await front.getAttribute("src"))!)).toContain("p-red-1.jpg");
    // a darker cover only when it is the cover again
    expect(await backs.nth(0).locator("img").evaluate((e) => getComputedStyle(e).filter)).toBe("none");
    expect(await backs.nth(2).locator("img").evaluate((e) => getComputedStyle(e).filter)).toContain("brightness(0.9)");
  });
});

test.describe("lead hints (D96)", () => {
  test("detail: nothing for 1 day, 「需提前 N 天预订」 for 2 and 3 days", async ({ page }) => {
    await openHome(page);
    await openDetail(page, "p-red");
    await expect(page.getByTestId("detail-lead")).toHaveCount(0);
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-lead")).toHaveText("需提前 2 天预订");
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-lead")).toHaveText("需提前 3 天预订");
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-lead")).toHaveCount(0);
  });
});

test.describe("narrow header with ordering closed", () => {
  for (const width of [320, 360, 390]) {
    test(`${width} px: wordmark, status and orders entry stay on single lines`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openHome(page, { orderingEnabled: false });
      await expect(page.getByTestId("ordering-state")).toHaveText("暂未开放预订 🍞");
      const m = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const lines = (sel: string) => {
          const el = document.querySelector(sel)!;
          const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
          return Math.round(el.getBoundingClientRect().height / lh);
        };
        return {
          wm: r(".hm-wm"),
          wmText: r(".hm-wm span"),
          wmLines: lines(".hm-wm span"),
          orders: r(".hm-orders"),
          ordersLines: lines(".hm-orders span"),
          status: r(".hm-open"),
          statusLines: lines(".hm-open"),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(m.wmLines).toBe(1);
      expect(m.ordersLines).toBe(1);
      expect(m.statusLines).toBe(1);
      expect(m.scrollWidth).toBeLessThanOrEqual(width);
      expect(m.orders.height).toBeGreaterThanOrEqual(44);
      // nothing overlaps: the orders entry and the status sit on different rows or different columns
      const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap(m.wm as DOMRect, m.orders as DOMRect)).toBe(false);
      expect(overlap(m.status as DOMRect, m.orders as DOMRect)).toBe(false);
      expect(overlap(m.status as DOMRect, m.wm as DOMRect)).toBe(false);
      expect(m.status.right).toBeLessThanOrEqual(width);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/k2_customer-header-${width}.png`, clip: { x: 0, y: 0, width, height: 360 } });
    });
  }
});

test.describe("screenshots", () => {
  test.skip(!SHOTS, "set K2_SHOTS to a folder");
  test("home: the pill and the tiles", async ({ page }) => {
    await openHome(page);
    await expect(page.getByTestId("hero-view")).toBeVisible();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/k2_customer-home-pill.png` });
    await page.getByRole("heading", { name: "全部面包" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/k2_customer-tiles.png` });
  });
});
