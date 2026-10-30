import { afterEach, describe, expect, it, vi } from "vitest";
import { isPropEntry, propEvents } from "@/components/tu/tuProps";
import { parseTuSave, readTuSave, TU_SAVE_KEY } from "@/components/tu/tuSave";
import { TU_ENGINE_VERSION, type TuEvent } from "@/lib/tu";

const raw = JSON.stringify({ v: 1, runId: "r", seed: "s", tiers: [{}, {}], taps: [{ p: "peek", at: 200 }], nickname: "n", expiresAt: "2099-01-01T00:00:00Z", score: 0 });

afterEach(() => vi.unstubAllGlobals());

describe("tu props (C8)", () => {
  it("collects prop, gain, bagSize and bonus events and ignores other engine events", () => {
    const evs: TuEvent[] = [
      { type: "prop", p: "swap", left: 0 },
      { type: "gain", p: "peek" },
      { type: "bagSize", size: 7 },
      { type: "bonus", points: 150 },
      { type: "bonus", points: 50 },
      { type: "over" },
    ];
    expect(propEvents(evs)).toEqual({ used: "swap", gained: ["peek"], bagSize: 7, bonus: 200 });
  });
  it("log entries tell taps from prop uses; the save key follows the engine version", () => {
    expect(isPropEntry({ p: "bag", at: 5 })).toBe(true);
    expect(isPropEntry({ id: 3, at: 5 })).toBe(false);
    expect(TU_SAVE_KEY).toBe(`bb_tu_save_v${TU_ENGINE_VERSION}`);
    expect(parseTuSave(raw)).not.toBeNull();
  });
  it("removes every other save version without skipping adjacent keys or unrelated storage", () => {
    const entries = new Map([
      ["bb_tu_save_v0", "old"],
      ["bb_tu_save_v1", "old"],
      [TU_SAVE_KEY, raw],
      [`bb_tu_save_v${TU_ENGINE_VERSION + 1}`, "future"],
      ["bb_tu_orders_seen_v1", "1"],
      ["bb_game_save_v1", "other game"],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        get length() { return entries.size; },
        key: (i: number) => [...entries.keys()][i] ?? null,
        getItem: (key: string) => entries.get(key) ?? null,
        removeItem: (key: string) => entries.delete(key),
      },
    });
    expect(readTuSave()).toEqual(JSON.parse(raw));
    expect([...entries.keys()]).toEqual([TU_SAVE_KEY, "bb_tu_orders_seen_v1", "bb_game_save_v1"]);
  });
  it("tolerates unavailable storage", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("unavailable"); } });
    expect(readTuSave()).toBeNull();
  });
});
