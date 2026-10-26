// L2: the board with REAL uploaded product photos (no mocks): the tier pictures are served through the
// image optimizer, arrive after the first frame, and must still show on the pieces; taps drop pieces and
// the score rises.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createAdminSession, resetAndSeed } from "./support/seed";

test.use({ browserName: "chromium" });

const PHOTO = readFileSync("tests/fixtures/bun-large.jpg");

/** Share of the canvas' pixels that are not the board background (pieces, guide, effects). */
async function inkShare(page: Page): Promise<number> {
  return page.getByTestId("game-canvas").evaluate((c: HTMLCanvasElement) => {
    const g = c.getContext("2d")!;
    const { data } = g.getImageData(0, Math.floor(c.height * 0.45), c.width, Math.floor(c.height * 0.55));
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      if (Math.abs(data[i] - 245) + Math.abs(data[i + 1] - 243) + Math.abs(data[i + 2] - 239) > 40) n++;
    }
    return n / (data.length / 28);
  });
}

test("real photos: pieces are drawn with their picture, taps drop them and the score rises", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const seeded = await resetAndSeed();
  await context.addCookies([{ name: "bb_session", value: await createAdminSession("e2e-game-photos"), url: baseURL! }]);
  for (const id of Object.values(seeded.products)) {
    const r = await page.request.post(`/api/admin/products/${id}/images`, {
      headers: { origin: baseURL! },
      multipart: { file: { name: "bun.jpg", mimeType: "image/jpeg", buffer: PHOTO } },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }

  await page.goto("/game");
  await page.getByTestId("game-wechat").fill("photo_player");
  await page.getByTestId("game-nickname").fill("有图");
  await page.getByTestId("game-start").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  // Before any tap (the loop is asleep): the piece in hand shows its photo once the photo has arrived.
  await expect
    .poll(() =>
      page.getByTestId("game-canvas").evaluate((c: HTMLCanvasElement) => {
        const g = c.getContext("2d")!;
        const { data } = g.getImageData(0, 0, c.width, Math.floor(c.height * 0.2));
        let brown = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] - data[i + 2] > 90) brown++;
        return brown;
      }),
    )
    .toBeGreaterThan(50);
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const tap = async (fx: number) => {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * 0.15;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  const xs = [0.2, 0.5, 0.8, 0.35, 0.65, 0.5, 0.25, 0.75];
  for (let i = 0; i < 12; i++) {
    await tap(xs[i % xs.length]);
    await page.waitForTimeout(330);
  }
  await expect(page.getByTestId("game-board")).toHaveAttribute("data-drops", "12");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/Users/tuzhechen/Documents/bunbunny-bake/.orchestrator/screens/l2_photos.png" });
  // Pieces are on the board (not an empty board with only a guide line).
  expect(await inkShare(page)).toBeGreaterThan(0.02);
  // Keep going until something merged: the score rises.
  for (let i = 0; i < 40; i++) {
    if (Number(await page.getByTestId("game-board").getAttribute("data-score")) > 0) break;
    if (await page.getByTestId("game-over-sheet").isVisible()) break;
    await tap(xs[i % xs.length]);
    await page.waitForTimeout(330);
  }
  await expect.poll(async () => Number(await page.getByTestId("game-board").getAttribute("data-score"))).toBeGreaterThan(0);
});
