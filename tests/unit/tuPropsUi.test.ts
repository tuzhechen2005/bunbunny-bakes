import { describe, expect, it } from "vitest";
import { bagSizeOf, canUse, isPropEntry, propEvents, propsOf, rewardsOf } from "@/components/tu/tuProps";
import { parseTuSave, TU_SAVE_KEY } from "@/components/tu/tuSave";
import { createTuGame, type TuEvent, type TuState } from "@/lib/tu";

const st = (extra: object = {}) => ({ batch: 1, tiles: [], bag: [], orders: [0, 1], score: 0, over: false, ...extra }) as unknown as TuState;

describe("tu props (C8) feature detection", () => {
  it("an engine without use / props means no props bar", () => {
    expect(propsOf(st())).toBeNull();
    expect(canUse({ ...createTuGame({ seed: "s", tiers: [{ id: "a" }, { id: "b" }, { id: "c" }] }), use: undefined } as never)).toBe(false);
    expect(canUse(null)).toBe(false);
    expect(bagSizeOf(st(), 6)).toBe(6);
    expect(rewardsOf(st())).toBeNull();
  });
  it("reads counts, bag size and rewards when present", () => {
    const s = st({ props: { peek: 2, bag: 0, swap: 1 }, bagSize: 7, rewards: [90, 60] });
    expect(propsOf(s)).toEqual({ peek: 2, bag: 0, swap: 1 });
    expect(bagSizeOf(s, 6)).toBe(7);
    expect(rewardsOf(s)).toEqual([90, 60]);
  });
  it("collects prop, gain, bagSize and bonus events and ignores unknown ones", () => {
    const evs = [
      { type: "prop", p: "swap", left: 0 },
      { type: "gain", p: "peek" },
      { type: "gain", p: "nope" },
      { type: "bagSize", size: 7 },
      { type: "bonus", points: 150 },
      { type: "bonus", points: 50 },
      { type: "mystery" },
    ] as unknown as TuEvent[];
    expect(propEvents(evs)).toEqual({ used: "swap", gained: ["peek"], bagSize: 7, bonus: 200 });
  });
  it("log entries tell taps from prop uses; the save key is v2", () => {
    expect(isPropEntry({ p: "bag", at: 5 })).toBe(true);
    expect(isPropEntry({ id: 3, at: 5 })).toBe(false);
    expect(TU_SAVE_KEY).toBe("bb_tu_save_v2");
    const raw = JSON.stringify({ v: 1, runId: "r", seed: "s", tiers: [{}, {}], taps: [{ p: "peek", at: 200 }], nickname: "n", expiresAt: "2099-01-01T00:00:00Z", score: 0 });
    expect(parseTuSave(raw)).not.toBeNull();
  });
});
