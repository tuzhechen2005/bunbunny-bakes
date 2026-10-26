// The engine must give bit-identical results in V8 (Node, Chromium) and JavaScriptCore (WebKit):
// the server replays what the browser played. Needs the chromium and webkit projects
// (see playwright.local.config.ts); on any other project it still checks Node against the page.

import { expect, test } from "@playwright/test";
import { botRun } from "../support/gameBot";
import { defaultTierDefs } from "@/lib/game";
import { engineBundleSource, TRACE_SOURCE } from "./support/gameEngineBundle";

const TIERS = defaultTierDefs(["a", "b", "c", "d", "e"]);
const CASES = [
  { seed: "cross-1", tiers: TIERS },
  { seed: "cross-2", tiers: TIERS },
  { seed: "cross-3", tiers: defaultTierDefs(["a", "b"]) },
];

test("engine results match between Node and the browser engine", async ({ page }) => {
  await page.goto("about:blank");
  const bundle = engineBundleSource();
  const nodeEngine = new Function(`return ${bundle}`)();
  const nodeTrace = new Function(`return ${TRACE_SOURCE}`)();

  for (const c of CASES) {
    const bot = botRun(c.seed, c.tiers, 150);
    const expected = nodeTrace(nodeEngine, c.seed, c.tiers, bot.log);
    // Sanity: the in-Node trace equals the vitest engine used everywhere else.
    expect(expected.score).toBe(bot.score);
    expect(expected.finalHash).toBe(bot.finalHash);
    expect(expected.replayScore).toBe(bot.score);
    expect(expected.hashes.length).toBeGreaterThan(2);

    const actual = await page.evaluate(
      ([bundleSrc, traceSrc, seed, tiers, drops]) => {
        const engine = new Function(`return ${bundleSrc}`)();
        const trace = new Function(`return ${traceSrc}`)();
        return trace(engine, seed, tiers, drops);
      },
      [bundle, TRACE_SOURCE, c.seed, c.tiers, bot.log] as const,
    );
    expect(actual).toEqual(expected);
  }
});
