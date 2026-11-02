// Shared RUN v10 e2e helpers: mocked APIs with the real engine, and event windows found with bots.
import { expect, type Page } from "@playwright/test";
import { copy } from "../../../src/copy";
import { createRunGame, replayRun, type RunInput, type RunEvent, type RunStartMode } from "../../../src/lib/run";
import { RUN_SAVE_KEY } from "../../../src/components/run/runSave";
import { goodRun, intermediateRun, perfectRun } from "../../support/runBot";

const g = copy.customer.game, t = copy.customer.run;
const HEX = "abcdef0123456789";
export const seedFor = (mode: RunStartMode, hex = HEX) => `v10.${hex}${mode === "normal" ? "" : `.${mode}`}`;
const BOARD = { liveScores: true, week: { start: "2026-12-07", end: "2026-12-13" }, top: [], lastWinner: null, allTime: null };

export async function mockApi(page: Page, opts: { hex?: string; rejectSpecial?: boolean } = {}) {
  const starts: Record<string, unknown>[] = [], finishes: { inputs: RunInput[]; endTick: number }[] = [];
  const seeds = new Map<string, string>();
  await page.route("**/api/menu", r => r.fulfill({ json: { products: [], ownerWechatId: "owner" } }));
  await page.route("**/api/game/hub", r => r.fulfill({ json: { liveScores: true, week: BOARD.week, prizeGame: "RUN", games: [] } }));
  await page.route("**/api/game/run/leaderboard**", r => r.fulfill({ json: BOARD }));
  await page.route("**/api/game/run/start", r => {
    const b = r.request().postDataJSON() as Record<string, unknown>;
    starts.push(b);
    const mode = (b.startMode as RunStartMode | undefined) ?? "normal";
    if (opts.rejectSpecial && mode !== "normal") return r.fulfill({ status: 400, json: { error: "VALIDATION", message: g.submitFailed } });
    const seed = seedFor(mode, opts.hex), runId = `run-${starts.length}`;
    seeds.set(runId, seed);
    return r.fulfill({ json: { runId, seed, startMode: mode, expiresAt: "2099-01-01T00:00:00Z" } });
  });
  await page.route("**/api/game/run/progress", r => r.fulfill({ json: { score: 0, live: true } }));
  await page.route("**/api/game/run/finish", r => {
    const b = r.request().postDataJSON();
    finishes.push(b);
    const score = replayRun(seeds.get(b.runId) ?? seedFor("normal", opts.hex), b.inputs, b.endTick).score;
    return r.fulfill({ json: { score, best: score, rank: 1, week: BOARD.week, personalBest: score, newRecord: false } });
  });
  return { starts, finishes };
}
/** This phone remembers its player and, optionally, that the player has finished a run. */
export const remember = (page: Page, played: boolean) =>
  page.addInitScript(({ played }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("bb_game_v1", JSON.stringify({ wechatId: "runner", nickname: "Baker", sound: false }));
    if (played) localStorage.setItem("bb_run_played_v1", JSON.stringify(["runner"]));
  }, { played });
export async function waitForRunning(page: Page) {
  const board = page.getByTestId("run-board");
  await expect(board).toBeVisible();
  await expect(board.getByText(t.loading, { exact: true })).toBeHidden({ timeout: 15000 });
  const previous = Number(await board.getAttribute("data-tick"));
  await expect.poll(async () => { await page.clock.runFor(100); return Number(await board.getAttribute("data-tick")); }).toBeGreaterThan(previous);
}
/** The first tap can land before hydration in dev; tap until the form is there. */
export async function openForm(page: Page) {
  await expect(async () => {
    await page.getByTestId("run-menu-start").click({ timeout: 2000 });
    await expect(page.getByTestId("run-start")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
}
export const phase = (page: Page) => page.getByTestId("run-board").getAttribute("data-phase");

export interface Window { seed: string; inputs: RunInput[]; resumeTick: number; eventTick: number }
/** First event (by `pick`) that still happens when the run resumes from the saved prefix with no further inputs. */
export function findWindow(pick: (e: RunEvent, prevLevel: number) => boolean, lead = 90): Window {
  const replayFrom = (seed: string, inputs: RunInput[], from: number, to: number) => {
    const game = createRunGame({ seed });
    inputs.forEach(i => game.input(i.tick, i.dir));
    game.step(from);
    let level = game.state().combo.level, found = 0;
    for (let tick = from + 1; tick <= to; tick++) for (const e of game.step(tick)) {
      if (pick(e, level) && !found) found = tick;
      if (e.type === "combo") level = e.level;
    }
    return game.state().over ? 0 : found;
  };
  for (let n = 0; n < 40; n++) {
    const seed = seedFor("normal", (0x1000 + n).toString(16).padStart(8, "0"));
    for (const bot of [perfectRun, goodRun, intermediateRun]) {
      const r = bot(seed, 3000);
      const game = createRunGame({ seed }), byTick = new Map(r.inputs.map(i => [i.tick, i.dir]));
      let level = 1;
      for (let tick = 1; tick <= r.endTick; tick++) {
        const dir = byTick.get(tick);
        const events = dir ? game.input(tick, dir) : game.step(tick);
        for (const e of events) {
          if (pick(e, level) && tick > 150) {
            const from = tick - lead, prefix = r.inputs.filter(i => i.tick <= from);
            const eventTick = replayFrom(seed, prefix, from, tick + 45);
            if (eventTick > from + lead / 3) return { seed, inputs: prefix, resumeTick: from, eventTick };
          }
          if (e.type === "combo") level = e.level;
        }
      }
    }
  }
  throw new Error("no event window found");
}
export async function resumeAt(page: Page, w: Window) {
  await page.addInitScript(({ key, save }) => {
    if (sessionStorage.getItem("seeded2")) return;
    sessionStorage.setItem("seeded2", "1");
    localStorage.setItem(key, JSON.stringify(save));
  }, { key: RUN_SAVE_KEY, save: { v: 1, runId: "saved-run", seed: w.seed, inputs: w.inputs, elapsedMs: w.resumeTick * 1000 / 60, score: replayRun(w.seed, w.inputs, w.resumeTick).score, nickname: "Baker", expiresAt: "2099-01-01T00:00:00Z" } });
  await mockApi(page);
  await page.clock.install();
  await page.goto("/game/run");
  await page.getByTestId("run-resume").click();
  await waitForRunning(page);
}

