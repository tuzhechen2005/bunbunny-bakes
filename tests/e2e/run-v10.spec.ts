// RUN v10 (D182) UI: sprint start, first-run practice, combo chip, near miss, death reason.
// Mocked APIs with the real engine; events are located with the real engine and bots.
import { expect, test } from "@playwright/test";
import { copy } from "../../src/copy";
import { createRunGame, type RunInput } from "../../src/lib/run";
import { RUN_SAVE_KEY } from "../../src/components/run/runSave";
import { findWindow, mockApi, openForm, phase, remember, resumeAt, seedFor, waitForRunning } from "./support/runV10";

const t = copy.customer.run;

for (const width of [320, 390]) test.describe(`RUN v10 ${width}px`, () => {
  test.use({ viewport: { width, height: 800 }, hasTouch: true });

  test("first run starts the optional practice, with gesture hints and a skip that is logged", async ({ page }) => {
    const api = await mockApi(page);
    await remember(page, false);
    await page.clock.install();
    await page.goto("/game/run");
    await expect(page.getByTestId("run-menu-sprint")).toHaveCount(0);
    await openForm(page);
    await page.getByTestId("run-start").click();
    await waitForRunning(page);
    expect(api.starts).toEqual([{ wechatId: "runner", nickname: "Baker", startMode: "practice" }]);
    await expect.poll(() => phase(page)).toBe("practice");
    await expect(page.getByTestId("run-practice")).toHaveText(t.practice);
    await expect(page.getByTestId("run-cue")).toHaveText(t.cueLane);
    await page.clock.runFor(4000);
    await expect(page.getByTestId("run-cue")).toHaveText(t.cueJump);
    await page.clock.runFor(4000);
    await expect(page.getByTestId("run-cue")).toHaveText(t.cueSlide);
    // The Next dev indicator can cover this corner at 320px; production has none.
    await page.getByTestId("run-skip").dispatchEvent("click");
    await page.clock.runFor(300);
    await expect.poll(() => phase(page)).toBe("running");
    await expect(page.getByTestId("run-skip")).toHaveCount(0);
    await expect(page.getByTestId("run-cue")).toHaveCount(0);
    const save = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), RUN_SAVE_KEY);
    expect(save.inputs.map((i: RunInput) => i.dir)).toEqual(["S"]);
    expect(save.seed).toMatch(/\.practice$/);
  });

  test("practice is declined by a server that knows an earlier run: a normal run starts instead", async ({ page }) => {
    const api = await mockApi(page, { rejectSpecial: true });
    await remember(page, false);
    await page.clock.install();
    await page.goto("/game/run");
    await openForm(page);
    await page.getByTestId("run-start").click();
    await waitForRunning(page);
    expect(api.starts).toEqual([{ wechatId: "runner", nickname: "Baker", startMode: "practice" }, { wechatId: "runner", nickname: "Baker" }]);
    expect(await phase(page)).toBe("running");
    await page.reload();
    await expect(page.getByTestId("run-resume")).toBeVisible();
  });

  test("second run offers 冲刺开局 beside 开始: speed lines, 冲刺中, ignored swipes, 接管 countdown, then control", async ({ page }) => {
    const api = await mockApi(page);
    await remember(page, true);
    await page.clock.install();
    await page.goto("/game/run");
    const sprint = page.getByTestId("run-menu-sprint"), start = page.getByTestId("run-menu-start");
    await expect(sprint).toHaveText(t.sprint);
    const [a, b] = await Promise.all([start.boundingBox(), sprint.boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await sprint.click();
    await waitForRunning(page);
    expect(api.starts).toEqual([{ wechatId: "runner", nickname: "Baker", startMode: "sprint" }]);
    const control = createRunGame({ seed: seedFor("sprint") }).state().controlTick;
    await expect(page.getByTestId("run-sprint")).toHaveText(t.sprintOn);
    await expect(page.getByTestId("run-board")).toHaveClass(/run-board-sprint/);
    // Swipes are ignored by the engine in the sprint and not logged.
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(300);
    await expect(page.getByTestId("run-board")).toHaveAttribute("data-lane", "1");
    await expect(page.getByTestId("run-takeover")).toHaveCount(0);
    await page.clock.runFor(Math.floor((control - 140) * 1000 / 60 - 600));
    await expect(page.getByTestId("run-takeover")).toContainText(t.takeover);
    await expect(page.getByTestId("run-takeover")).toContainText("2");
    await page.clock.runFor(1000);
    await expect(page.getByTestId("run-takeover")).toContainText("1");
    await page.clock.runFor(1500);
    await expect.poll(() => phase(page)).toBe("running");
    await expect(page.getByTestId("run-takeover")).toHaveCount(0);
    await expect(page.getByTestId("run-sprint")).toHaveCount(0);
    const save = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), RUN_SAVE_KEY);
    expect(save.inputs).toEqual([]);
    expect(save.seed).toMatch(/\.sprint$/);
    // Control is back: a swipe now changes lane.
    await page.keyboard.press("ArrowLeft");
    await page.clock.runFor(300);
    await expect(page.getByTestId("run-board")).toHaveAttribute("data-lane", "0");
  });

  test("combo chip appears at ×2", async ({ page }) => {
    const level2 = findWindow(e => e.type === "combo" && e.level === 2);
    await resumeAt(page, level2);
    await expect(page.getByTestId("run-combo")).toHaveCount(0);
    await page.clock.runFor(Math.ceil((level2.eventTick - level2.resumeTick + 6) * 1000 / 60));
    await expect(page.getByTestId("run-combo")).toHaveAttribute("data-level", "2");
    await expect(page.getByTestId("run-combo")).toContainText("×2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test("near miss pops 好险 near the bunny", async ({ page }) => {
    const near = findWindow(e => e.type === "near-miss", 15);
    await resumeAt(page, near);
    await page.clock.runFor(Math.ceil((near.eventTick - near.resumeTick + 6) * 1000 / 60));
    await expect(page.getByTestId("run-near-miss")).toHaveText(t.nearMiss);
  });

  test("a broken combo shakes out of the chip", async ({ page }) => {
    const lost = findWindow((e, level) => e.type === "combo" && e.level === 1 && level > 1);
    await resumeAt(page, lost);
    await page.clock.runFor(Math.ceil((lost.eventTick - lost.resumeTick + 6) * 1000 / 60));
    await expect(page.getByTestId("run-combo-lost")).toHaveCount(1);
    await expect(page.getByTestId("run-combo")).toHaveCount(0);
  });

  test("death shows the hit obstacle's reason on the result sheet", async ({ page }) => {
    const api = await mockApi(page);
    await remember(page, true);
    await page.clock.install();
    await page.goto("/game/run");
    await openForm(page);
    await page.getByTestId("run-start").click();
    await waitForRunning(page);
    await page.clock.runFor(40000);
    await expect(page.getByTestId("run-over-sheet")).toBeVisible();
    const game = createRunGame({ seed: seedFor("normal") });
    game.step(api.finishes[0].endTick);
    const death = game.state().death!;
    const lines = t.death as Record<string, string>;
    await expect(page.getByTestId("run-death")).toHaveText(lines[death.kind]);
    expect(Object.keys(lines)).toContain(death.kind);
    // The sheet stays on the page at both widths.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test("a finished first run unlocks the sprint offer on the result sheet", async ({ page }) => {
    await mockApi(page);
    await remember(page, false);
    await page.clock.install();
    await page.goto("/game/run");
    await openForm(page);
    await page.getByTestId("run-start").click();
    await waitForRunning(page);
    await page.clock.runFor(60000);
    await expect(page.getByTestId("run-over-sheet")).toBeVisible();
    await expect(page.getByTestId("run-again-sprint")).toHaveText(t.sprint);
    expect(await page.evaluate(() => localStorage.getItem("bb_run_played_v1"))).toBe(JSON.stringify(["runner"]));
  });
});
