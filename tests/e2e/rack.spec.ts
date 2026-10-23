// Home rope rack, spin + take down, detail, list (FRONTEND.md 4.1 / 4.2, D77).
// Swipe reliability on real phones was the owner's top complaint, so the gestures are driven with
// real touch events through CDP (Input.dispatchTouchEvent, Chromium only): the same pipeline a finger
// takes, including the browser deciding between "scroll the page" and "the page handles it".
import { readFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";

test.use({ browserName: "chromium" });

const PHOTO = readFileSync("tests/fixtures/bun.jpg");

const PRODUCTS = [
  { id: "p-redbean", name: "奶酥红豆包", description: "红豆馅", unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p-rock", name: "岩烧乳酪包", description: "乳酪", unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 1 },
  { id: "p-brulee", name: "焦糖布蕾", description: "布蕾", unitPriceCents: 249, bundleSize: 4, bundlePriceCents: 899, status: "ACTIVE", leadDays: 2 },
  { id: "p-wedge", name: "奶酪角", description: "奶酪", unitPriceCents: 299, bundleSize: 4, bundlePriceCents: 1099, status: "PAUSED", leadDays: 1 },
].map((p) => ({ ...p, imageUrl: `/api/images/mock/${p.id}.jpg` }));

async function mockHome(page: Page, products = PRODUCTS) {
  await page.route("**/api/menu", (route) =>
    route.fulfill({
      json: { orderingEnabled: true, products, pickupNote: "", deliveryFeeCents: 500, freeDeliveryMinCents: 2500, maxQtyPerItem: 8 },
    }),
  );
  await page.route("**/api/images/mock/*", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
}

/**
 * Waits until the entrance drop, the rope and every peg are at rest: every card sits where the
 * rope puts it (not still above the rope waiting for its turn) and nothing changed for a while.
 */
async function settled(page: Page) {
  await expect(page.getByTestId("rack")).toBeVisible();
  let last = "";
  let stableFor = 0;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const rack = document.querySelector(".hm-rack")!.getBoundingClientRect();
          const cards = [...document.querySelectorAll<HTMLElement>(".hm-card")];
          const dropped = cards.every((c) => {
            const top = c.getBoundingClientRect().top - rack.top;
            return top > -10 && top < 80;
          });
          return dropped ? cards.map((c) => `${c.style.transform}${c.firstElementChild!.getAttribute("style")}`).join("|") : "";
        });
        stableFor = now !== "" && now === last ? stableFor + 1 : 0;
        last = now;
        return stableFor >= 3;
      },
      { intervals: [100], timeout: 10000 },
    )
    .toBe(true);
}

const selectedIndex = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".hm-card")].findIndex((c) => c.getAttribute("aria-selected") === "true"));
const currentName = (page: Page) => page.getByTestId("current-name").locator("span:not([aria-hidden])");

interface Finger {
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
}

/**
 * A finger with a virtual clock: every event carries an explicit timestamp, so velocity and "paused
 * before release" do not depend on how fast the test runner is. Real waits keep the browser's own
 * scroll recogniser fed (it needs frames between the moves).
 */
function finger(cdp: CDPSession): Finger & { clock: number; wait(ms: number): Promise<void> } {
  let x = 0;
  let y = 0;
  const f = {
    clock: Date.now() / 1000,
    async wait(ms: number) {
      f.clock += ms / 1000;
      await new Promise((r) => setTimeout(r, Math.min(ms, 40)));
    },
    async down(px: number, py: number) {
      x = px;
      y = py;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }], timestamp: f.clock });
    },
    async move(px: number, py: number) {
      x = px;
      y = py;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 0 }], timestamp: f.clock });
    },
    async up() {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: f.clock });
    },
  };
  return f;
}

/** Drag from (x0,y0) to (x1,y1) in `steps` moves, `ms` in total, then optionally hold still before lifting. */
async function drag(
  f: ReturnType<typeof finger>,
  from: [number, number],
  to: [number, number],
  { steps = 12, ms = 240, hold = 0 }: { steps?: number; ms?: number; hold?: number } = {},
) {
  await f.down(from[0], from[1]);
  for (let i = 1; i <= steps; i++) {
    await f.wait(ms / steps);
    await f.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  }
  if (hold) await f.wait(hold);
  await f.up();
}

/** Distance (px) between the middle of card `i` and the middle of the screen. */
const offCentre = (page: Page, i: number) =>
  page.evaluate((k) => {
    const r = document.querySelector(`.hm-card[data-card="${k}"]`)!.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - window.innerWidth / 2);
  }, i);

/** Counts requestAnimationFrame calls from now on; resolves once a 500 ms window had none. */
async function expectLoopAsleep(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __raf?: number; __rafPatched?: boolean };
    w.__raf = 0;
    if (w.__rafPatched) return;
    w.__rafPatched = true;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf = (w.__raf ?? 0) + 1;
      return orig(cb);
    };
  });
  await expect
    .poll(
      async () => {
        await page.evaluate(() => ((window as unknown as { __raf: number }).__raf = 0));
        await page.waitForTimeout(500);
        return page.evaluate(() => (window as unknown as { __raf: number }).__raf);
      },
      { timeout: 12000, intervals: [50] },
    )
    .toBe(0);
}

async function centreOf(page: Page, selector: string): Promise<[number, number]> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

test.describe("rope gestures with real touch events (CDP)", () => {
  let cdp: CDPSession;
  let f: ReturnType<typeof finger>;
  let touchmoves: { prevented: boolean; cancelable: boolean }[];

  test.beforeEach(async ({ page, context }) => {
    await mockHome(page);
    await page.goto("/");
    await settled(page);
    cdp = await context.newCDPSession(page);
    f = finger(cdp);
    // What the page decided about every touchmove (window sees it after the hero's own handler).
    touchmoves = [];
    await page.exposeFunction("__tm", (prevented: boolean, cancelable: boolean) => touchmoves.push({ prevented, cancelable }));
    await page.evaluate(() =>
      window.addEventListener("touchmove", (e) => (window as unknown as { __tm: (a: boolean, b: boolean) => void }).__tm(e.defaultPrevented, e.cancelable), {
        passive: true,
      }),
    );
  });

  test("slow drag past half a card moves one card; a short slow drag springs back", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 100, cy], [cx - 60, cy], { steps: 20, ms: 900, hold: 200 }); // 160 px of 227 px spacing
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await expect(currentName(page)).toHaveText("岩烧乳酪包");
    await settled(page);

    await drag(f, [cx, cy], [cx - 50, cy], { steps: 15, ms: 700, hold: 200 }); // 50 px: not enough
    await settled(page);
    expect(await selectedIndex(page)).toBe(1);
    // and back to the first with a long slow drag the other way
    await drag(f, [cx - 100, cy], [cx + 70, cy], { steps: 20, ms: 900, hold: 200 });
    await expect.poll(() => selectedIndex(page)).toBe(0);
  });

  test("fast fling moves exactly one card, however long the swipe", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 120, cy], [cx - 40, cy], { steps: 6, ms: 70 }); // 160 px in 70 ms
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await settled(page);
    await drag(f, [cx + 160, cy], [cx - 160, cy], { steps: 8, ms: 90 }); // a huge fling still moves one
    await expect.poll(() => selectedIndex(page)).toBe(2);
    await settled(page);
    expect(await selectedIndex(page)).toBe(2);
    // a short flick (30 px) is enough
    await drag(f, [cx + 15, cy], [cx - 15, cy], { steps: 3, ms: 40 });
    await expect.poll(() => selectedIndex(page)).toBe(3);
    // nothing beyond the last card: the rope rubber-bands back
    await settled(page);
    await drag(f, [cx + 60, cy], [cx - 60, cy], { steps: 6, ms: 60 });
    await settled(page);
    expect(await selectedIndex(page)).toBe(3);
  });

  test("diagonal flings (up to ~50 degrees) belong to the rope, not to the page", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await drag(f, [cx + 70, cy - 50], [cx - 50, cy + 60], { steps: 8, ms: 80 }); // dx -120, dy +110
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await settled(page);
    await drag(f, [cx + 50, cy + 60], [cx - 50, cy - 50], { steps: 8, ms: 80 }); // dx -100, dy -110 (upwards)
    await expect.poll(() => selectedIndex(page)).toBe(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    // Every touchmove of both gestures was claimed by the rope, so the browser never scrolled.
    expect(touchmoves.length).toBeGreaterThan(4);
    expect(touchmoves.every((m) => m.cancelable && m.prevented)).toBe(true);
  });

  test("a drag that starts on the headline, the price or the empty colour field also moves the rope", async ({ page }) => {
    const slogan = await page.locator(".hm-slogan").boundingBox();
    const info = await page.locator(".hm-info").boundingBox();
    await drag(f, [300, slogan!.y + 10], [100, slogan!.y + 22], { steps: 6, ms: 70 });
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await settled(page);
    await drag(f, [300, info!.y + 20], [100, info!.y + 35], { steps: 6, ms: 70 });
    await expect.poll(() => selectedIndex(page)).toBe(2);
  });

  test("vertical swipes scroll the page and leave the rope alone", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 6, cy + 120], [cx - 6, cy - 130], { steps: 10, ms: 160 }); // almost straight up, starting on the photo
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(40);
    expect(await selectedIndex(page)).toBe(0);
    // none of it was claimed by the rope: the page owns vertical gestures
    expect(touchmoves.some((m) => m.prevented)).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    // also when it starts on the colour field beside the rope and drifts a little sideways
    await drag(f, [330, 120], [300, 330], { steps: 8, ms: 140 });
    await page.waitForTimeout(100);
    expect(await selectedIndex(page)).toBe(0);
  });

  test("tap on the centre photo spins it and opens the detail; the hint goes away", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await expect(page.getByTestId("try-me")).not.toHaveClass(/is-off/);
    await f.down(cx, cy);
    await f.wait(60);
    await f.up();
    // spinning: the flip element is animating, the detail is not there yet
    await expect
      .poll(() => page.evaluate(() => [...document.querySelectorAll(".hm-flip")].flatMap((e) => e.getAnimations()).filter((a) => !(a instanceof CSSTransition)).length))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("detail")).toHaveCount(0);
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId("detail-name")).toHaveText("奶酥红豆包");
    await expect(page.getByTestId("try-me")).toHaveClass(/is-off/);
    expect(await page.evaluate(() => sessionStorage.getItem("bb_tryme_done"))).toBe("1");
  });

  test("a tap with a few pixels of finger jitter is still a tap", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await f.down(cx, cy);
    await f.wait(30);
    await f.move(cx + 2, cy + 3);
    await f.wait(50);
    await f.up();
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
  });

  test("tapping a side photo slides it to the centre instead of opening it", async ({ page }) => {
    const [rx, ry] = await centreOf(page, '.hm-card[data-card="1"] .hm-face:not(.hm-back)');
    const vw = page.viewportSize()!.width;
    await f.down(Math.min(rx, vw - 14), ry); // the visible sliver at the right edge
    await f.wait(50);
    await f.up();
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await expect(page.getByTestId("detail")).toHaveCount(0);
    await settled(page);
    // now it is the centre card: a tap opens it
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="1"] .hm-face:not(.hm-back)');
    await f.down(cx, cy);
    await f.wait(50);
    await f.up();
    await expect(page.getByTestId("detail-name")).toHaveText("岩烧乳酪包", { timeout: 2000 });
  });

  test("catching the moving rope with a finger is not a tap", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 120, cy], [cx - 40, cy], { steps: 5, ms: 60 });
    await page.waitForTimeout(120); // still gliding
    await f.down(cx, cy);
    await f.wait(40);
    await f.up();
    await page.waitForTimeout(900);
    await expect(page.getByTestId("detail")).toHaveCount(0);
  });

  test("buttons on the hero still work and never start a drag", async ({ page }) => {
    const [bx, by] = await centreOf(page, '[data-testid="hero-add"]');
    await f.down(bx, by);
    await f.wait(40);
    await f.up();
    await expect(page.getByTestId("bag-count")).toContainText("1");
    expect(await selectedIndex(page)).toBe(0);
  });

  test("detail: pull down more than 90 px hangs it back, less springs back", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await f.down(cx, cy);
    await f.wait(40);
    await f.up();
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(800);

    const photo = await page.locator(".hm-dt-ph").boundingBox();
    const px = photo!.x + photo!.width / 2;
    await drag(f, [px, photo!.y + 120], [px + 6, photo!.y + 120 + 60], { steps: 8, ms: 160, hold: 100 }); // 60 px: stays
    await page.waitForTimeout(600);
    await expect(page.getByTestId("detail")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector<HTMLElement>(".hm-dt-ph")!.style.transform)).toBe("");

    await drag(f, [px, photo!.y + 100], [px + 8, photo!.y + 100 + 150], { steps: 10, ms: 200 }); // 150 px: closes
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator(".hm-card.is-taken")).toHaveCount(0);
    expect(await selectedIndex(page)).toBe(0);
    // vertical pull on the page below the hero scrolls normally again afterwards
    await drag(f, [cx, 500], [cx, 200], { steps: 8, ms: 140 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(20);
  });
  // ---- regressions found in review (real-phone failures) ----

  test("a finger that started on the bread's name keeps working after the name node is swapped out", async ({ page }) => {
    // The old name <span> is removed from the page while the finger is still down; touch events keep
    // going to it. The gesture must still end: the rope snaps onto a card, the loop sleeps, the next
    // swipe works.
    const name = await page.locator(".hm-name span").first().boundingBox();
    const nx = name!.x + 20;
    const ny = name!.y + name!.height / 2;
    await f.down(nx, ny);
    for (let i = 1; i <= 20; i++) {
      await f.wait(30);
      await f.move(nx - 8 * i, ny + (i % 3));
    }
    await expect(page.locator(".hm-name span")).toHaveCount(1, { timeout: 3000 }); // swapped
    await f.wait(500);
    await f.move(nx - 175, ny);
    await f.wait(60);
    await f.up();
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await expect.poll(() => offCentre(page, 1), { timeout: 4000 }).toBeLessThan(2);
    await expectLoopAsleep(page);
    // the very next fling still moves exactly one card
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="1"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 100, cy], [cx - 60, cy], { steps: 6, ms: 70 });
    await expect.poll(() => selectedIndex(page)).toBe(2);
  });

  test("a stale gesture whose touchend never came does not swallow the next swipe", async ({ page }) => {
    // Synthetic touch events: the browser itself would never leave a gesture open like this, but a
    // lost touchend (detached node, host app) looks exactly like it to the page.
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await page.evaluate(
      async ([x, y]) => {
        const target = document.querySelector('.hm-card[data-card="0"] .hm-face') as HTMLElement;
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const touch = (id: number, px: number) => new Touch({ identifier: id, target, clientX: px, clientY: y });
        const fire = (type: string, id: number, px: number, live: boolean) => {
          const t = touch(id, px);
          target.dispatchEvent(
            new TouchEvent(type, { bubbles: true, cancelable: true, touches: live ? [t] : [], targetTouches: live ? [t] : [], changedTouches: [t] }),
          );
        };
        // gesture 1: moves, then nothing (no touchend)
        fire("touchstart", 1, x + 100, true);
        for (let i = 1; i <= 4; i++) {
          await wait(16);
          fire("touchmove", 1, x + 100 - 10 * i, true);
        }
        // gesture 2 on a new finger: must start over and fling one card
        fire("touchstart", 2, x + 100, true);
        for (let i = 1; i <= 6; i++) {
          await wait(10);
          fire("touchmove", 2, x + 100 - 28 * i, true);
        }
        fire("touchend", 2, x + 100 - 168, false);
      },
      [cx, cy],
    );
    await expect.poll(() => selectedIndex(page)).toBe(1);
  });

  test("a second finger mid-drag gives the gesture up: the rope snaps to a card and the next fling works", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await f.down(cx + 100, cy);
    for (let i = 1; i <= 8; i++) {
      await f.wait(25);
      await f.move(cx + 100 - 12 * i, cy); // 96 px: less than half a card
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx + 4, y: cy, id: 0 },
        { x: cx + 150, y: cy + 80, id: 1 },
      ],
    });
    await f.wait(100);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => selectedIndex(page)).toBe(0);
    await expect.poll(() => offCentre(page, 0), { timeout: 4000 }).toBeLessThan(2);
    await expectLoopAsleep(page);
    await drag(f, [cx + 100, cy], [cx - 60, cy], { steps: 6, ms: 70 });
    await expect.poll(() => selectedIndex(page)).toBe(1);
  });

  test("touchcancel mid-drag (the host app took the gesture) snaps to the nearest card and the next fling works", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await f.down(cx + 100, cy);
    for (let i = 1; i <= 8; i++) {
      await f.wait(25);
      await f.move(cx + 100 - 20 * i, cy); // 160 px: more than half a card
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect.poll(() => selectedIndex(page)).toBe(1); // nearest card, no fling
    await expect.poll(() => offCentre(page, 1), { timeout: 4000 }).toBeLessThan(2);
    await expectLoopAsleep(page);
    const [x1, y1] = await centreOf(page, '.hm-card[data-card="1"] .hm-face:not(.hm-back)');
    await drag(f, [x1 + 100, y1], [x1 - 60, y1], { steps: 6, ms: 70 });
    await expect.poll(() => selectedIndex(page)).toBe(2);
  });

  test("a tap whose finger rolls up to ~6 px is still a tap", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await f.down(cx, cy);
    await f.wait(30);
    await f.move(cx + 6, cy + 3);
    await f.wait(60);
    await f.up();
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
  });
});

test.describe("mouse and keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockHome(page);
    await page.goto("/");
    await settled(page);
  });

  test("mouse drag (pointer events) moves the rope; a click opens the detail", async ({ page }) => {
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await page.mouse.move(cx + 100, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 60, cy, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await settled(page);
    const [x1, y1] = await centreOf(page, '.hm-card[data-card="1"] .hm-face:not(.hm-back)');
    await page.mouse.click(x1, y1);
    await expect(page.getByTestId("detail-name")).toHaveText("岩烧乳酪包", { timeout: 2000 });
  });

  test("a mouse press released outside the column does not jam the next drag", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.reload();
    await settled(page);
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 30, { steps: 4 }); // vertical: never captured
    await page.mouse.move(60, cy + 30, { steps: 6 }); // out of the 430 px column
    await page.mouse.up();
    expect(await selectedIndex(page)).toBe(0);
    await page.mouse.move(cx + 100, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 60, cy, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => selectedIndex(page)).toBe(1);
  });

  test("prev / next pressed while the detail hangs back leaves no card hidden", async ({ page }) => {
    await page.getByTestId("rack").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
    await page.getByTestId("detail-next").focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter"); // "next" while closing
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator(".hm-card.is-taken")).toHaveCount(0);
    expect(await selectedIndex(page)).toBe(0);
  });

  test("keyboard: arrows move, Enter takes down, Esc hangs back and returns focus to the rope", async ({ page }) => {
    await page.getByTestId("rack").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => selectedIndex(page)).toBe(2);
    await expect(currentName(page)).toHaveText("焦糖布蕾");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("detail-name")).toHaveText("岩烧乳酪包", { timeout: 2000 });
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("detail-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByTestId("rack")).toBeFocused();
  });

  test("everything rests: no animation frame is requested once the rope and pegs are still", async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf++;
        return orig(cb);
      };
    });
    // After the entrance drop has died down there must be a quiet window with zero frames.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => ((window as unknown as { __raf: number }).__raf = 0));
          await page.waitForTimeout(500);
          return page.evaluate(() => (window as unknown as { __raf: number }).__raf);
        },
        { timeout: 12000, intervals: [50] },
      )
      .toBe(0);
    // ...and input wakes it up again
    await page.getByTestId("rack").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __raf: number }).__raf)).toBeGreaterThan(0);
  });

  test("the rope is a labelled listbox and the colour follows the bread", async ({ page }) => {
    await expect(page.getByRole("listbox", { name: /左右滑动/ })).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(4);
    const field = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--field"));
    expect(await field()).toBe("#DCC5BB");
    await page.getByTestId("rack").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(field).toBe("#F0BF45");
    await page.keyboard.press("ArrowRight");
    await expect.poll(field).toBe("#CFDDEA");
  });

  test("hero + puts the current bread in the bag (and is off for paused ones)", async ({ page }) => {
    await page.getByTestId("hero-add").click();
    await page.getByTestId("hero-add").click();
    await expect(page.getByTestId("bag-count")).toContainText("2");
    await expect(page.getByTestId("bag-live")).toContainText("已放进纸袋：奶酥红豆包");
    expect(await page.evaluate(() => localStorage.getItem("bb_cart_v1"))).toBe(JSON.stringify([{ productId: "p-redbean", qty: 2 }]));
    await page.getByTestId("rack").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(() => selectedIndex(page)).toBe(3);
    await expect(page.getByTestId("hero-add")).toBeDisabled();
    await expect(page.getByTestId("current")).toContainText("暂停供应");
  });

  test("detail: prev / next, quantity, price, lead hint, add with a count, hang back", async ({ page }) => {
    await page.getByTestId("rack").focus();
    await page.keyboard.press("Enter");
    const detail = page.getByTestId("detail");
    await expect(detail).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId("detail-pos")).toHaveText("1 / 4");
    await expect(page.getByTestId("detail-unit")).toHaveText("$2.49");
    await expect(page.getByTestId("detail-bundle")).toHaveText("$8.99");
    await expect(page.getByTestId("detail-lead")).toHaveCount(0);
    await expect(page.getByTestId("detail-prev")).toBeDisabled();

    // qty 5 -> one bundle of 4 plus one: $8.99 + $2.49
    for (let i = 0; i < 4; i++) await page.getByTestId("detail-inc").click();
    await expect(page.getByTestId("detail-qty")).toContainText("5");
    await expect(page.getByTestId("detail-add")).toContainText("$11.48");
    await page.getByTestId("detail-add").click();
    await expect(page.getByTestId("bag-count")).toContainText("5");
    await expect(page.getByTestId("bag-bar")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("bb_cart_v1"))).toBe(JSON.stringify([{ productId: "p-redbean", qty: 5 }]));

    // next: the brûlée needs two days' notice, the page and the rope follow
    await page.getByTestId("detail-next").click();
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-name")).toHaveText("焦糖布蕾");
    await expect(page.getByTestId("detail-pos")).toHaveText("3 / 4");
    await expect(page.getByTestId("detail-lead")).toHaveText("布蕾需提前两天");
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--field"))).toBe("#CFDDEA");

    // the paused one cannot be added
    await page.getByTestId("detail-next").click();
    await expect(page.getByTestId("detail-name")).toHaveText("奶酪角");
    await expect(page.getByTestId("detail-add")).toBeDisabled();
    await expect(page.getByTestId("detail-next")).toBeDisabled();

    // hang back on the product we ended on: the rope shows it in the middle
    await page.getByTestId("detail-close").click();
    await expect(detail).toHaveCount(0, { timeout: 3000 });
    expect(await selectedIndex(page)).toBe(3);
    await expect(page.locator(".hm-card.is-taken")).toHaveCount(0);
  });

  test("detail respects the per-item maximum", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("bb_cart_v1", JSON.stringify([{ productId: "p-redbean", qty: 6 }])));
    await page.reload();
    await settled(page);
    await page.getByTestId("rack").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 2000 });
    // 6 in the bag, max 8: room for two more
    await expect(page.getByTestId("detail-dec")).toBeDisabled();
    await page.getByTestId("detail-inc").click();
    await expect(page.getByTestId("detail-inc")).toBeDisabled();
    await expect(page.getByTestId("detail-add")).toContainText("$4.98");
    await page.getByTestId("detail-add").click();
    expect(await page.evaluate(() => localStorage.getItem("bb_cart_v1"))).toBe(JSON.stringify([{ productId: "p-redbean", qty: 8 }]));
    await expect(page.getByTestId("detail-add")).toBeDisabled();
    await expect(page.getByTestId("detail").getByText("大量订购请加微信联系")).toBeVisible();
  });

  test("list: tiles add / step, paused tile greyed and not addable", async ({ page }) => {
    const tile = (id: string) => page.locator(`[data-testid="product-card"][data-product-id="${id}"]`);
    await tile("p-rock").getByRole("button", { name: "增加一个" }).click();
    await expect(tile("p-rock").getByTestId("qty")).toHaveText("1");
    await tile("p-rock").getByRole("button", { name: "增加一个" }).click();
    await expect(tile("p-rock").getByTestId("qty")).toHaveText("2");
    await tile("p-rock").getByRole("button", { name: "减少一个" }).click();
    await tile("p-rock").getByRole("button", { name: "减少一个" }).click();
    await expect(tile("p-rock").getByTestId("qty")).toHaveCount(0);
    await expect(tile("p-wedge").getByRole("button", { name: "增加一个" })).toBeDisabled();
    await expect(tile("p-wedge").getByText("暂停供应")).toBeVisible();
    await expect(page.getByRole("heading", { name: "全部面包" })).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no spin, no swing: the detail opens at once and the rope jumps", async ({ page }) => {
    await mockHome(page);
    await page.goto("/");
    await settled(page);
    await page.getByTestId("rack").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => selectedIndex(page)).toBe(1);
    // the rope is exactly on slot 1 right away (no spring travel)
    const offset = await page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('.hm-card[data-card="1"]')!;
      return Math.abs(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2 - window.innerWidth / 2);
    });
    expect(offset).toBeLessThan(2);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("detail")).toBeVisible({ timeout: 700 });
    // no scripted animation on any peg (colour transitions of the recolouring field do not count)
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll(".hm-flip")].flatMap((e) => e.getAnimations()).filter((a) => !(a instanceof CSSTransition)).length,
      ),
    ).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("detail")).toHaveCount(0, { timeout: 2000 });
  });
  test("the rope does not sway after a swipe: every card keeps its height", async ({ page, context }) => {
    await mockHome(page);
    await page.goto("/");
    await settled(page);
    const cdp = await context.newCDPSession(page);
    const f = finger(cdp);
    const [cx, cy] = await centreOf(page, '.hm-card[data-card="0"] .hm-face:not(.hm-back)');
    await drag(f, [cx + 120, cy], [cx - 40, cy], { steps: 5, ms: 60 });
    await expect.poll(() => selectedIndex(page)).toBe(1);
    await settled(page);
    const ys: number[] = [];
    for (let i = 0; i < 8; i++) {
      ys.push(await page.evaluate(() => document.querySelector('.hm-card[data-card="1"]')!.getBoundingClientRect().top));
      await page.waitForTimeout(120);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
  });
});

test.describe("states", () => {
  test("loading, error with retry, empty menu, closed", async ({ page }) => {
    let mode: "error" | "empty" | "closed" = "error";
    const menu = (products: unknown[], orderingEnabled: boolean) => ({
      orderingEnabled,
      products,
      pickupNote: "",
      deliveryFeeCents: 500,
      freeDeliveryMinCents: 2500,
      maxQtyPerItem: 8,
    });
    await page.route("**/api/menu", async (route) => {
      if (mode === "error") return route.fulfill({ status: 500, json: { error: "x" } });
      return route.fulfill({ json: mode === "empty" ? menu([], true) : menu(PRODUCTS, false) });
    });
    await page.route("**/api/images/mock/*", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
    await page.goto("/");
    await expect(page.getByText("菜单加载失败，请稍后再试")).toBeVisible();
    mode = "empty";
    await page.getByRole("button", { name: "重新加载" }).click();
    await expect(page.getByText("暂时还没有可以预订的面包～")).toBeVisible();
    mode = "closed";
    await page.reload();
    await expect(page.getByText("暂未开放预订 🍞")).toBeVisible();
    await expect(page.getByTestId("rack")).toBeVisible();
  });

  test("404 page: logo, one line, a way home", async ({ page }) => {
    await page.goto("/definitely-not-a-page");
    await expect(page.getByRole("img", { name: "兔的大面包" })).toBeVisible();
    await expect(page.getByText("找不到这个订单")).toBeVisible();
    await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
  });

  test("no horizontal scroll at 320 px, and the slogan fits on one line", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockHome(page);
    await page.goto("/");
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const slogan = await page.locator(".hm-slogan").evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(slogan[0]).toBeLessThanOrEqual(slogan[1]);
  });

  test("desktop: the same 430 px column, centred", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockHome(page);
    await page.goto("/");
    await settled(page);
    const box = await page.locator(".hm-app").boundingBox();
    expect(box!.width).toBe(430);
    expect(box!.x).toBe(425);
  });
});
