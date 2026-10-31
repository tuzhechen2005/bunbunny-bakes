import { afterEach, expect, it, vi } from "vitest";
import { M3_ENGINE_VERSION, M3ReplayError, m3Seed, replayM3 } from "@/lib/m3";
import { M3_SAVE_KEY, parseM3Save, readM3Save } from "@/components/m3/m3Save";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, radius: .1, points: 10, imageUrl: null, color: { bg: "white", ink: "black" } }));
const save = { v: 1, runId: "run", seed: m3Seed("abcdef"), tiers, moves: [], nickname: "baker", expiresAt: "2099-01-01", score: 0 };
afterEach(() => vi.unstubAllGlobals());

it("rejects old/future versioned replay seeds and saves even with an empty move log", () => {
  expect(M3_ENGINE_VERSION).toBe(2);
  expect(M3_SAVE_KEY).toBe("bb_m3_save_v2");
  expect(parseM3Save(JSON.stringify(save), 0)).toEqual(save);
  for (const seed of ["v1.abcdef", "v3.abcdef"]) {
    expect(() => replayM3(seed, tiers, [])).toThrow(M3ReplayError);
    expect(parseM3Save(JSON.stringify({ ...save, seed }), 0)).toBeNull();
  }
});

it("discards v1 local storage saves while preserving the current v2 save", () => {
  const entries = new Map([["bb_m3_save_v1", JSON.stringify({ ...save, seed: "v1.abcdef" })],
    [M3_SAVE_KEY, JSON.stringify(save)], ["unrelated", "keep"]]);
  vi.stubGlobal("window", { localStorage: {
    get length() { return entries.size; },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => { entries.delete(key); },
  } });
  expect(readM3Save(0)).toEqual(save);
  expect([...entries.keys()]).toEqual([M3_SAVE_KEY, "unrelated"]);
});
