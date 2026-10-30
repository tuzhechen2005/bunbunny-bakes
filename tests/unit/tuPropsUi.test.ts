import { afterEach, describe, expect, it, vi } from "vitest";
import { isPropEntry, orderCompleteText, propEvents } from "@/components/tu/tuProps";
import { parseTuSave, readTuSave, writeTuSave, TU_SAVE_KEY } from "@/components/tu/tuSave";
import { TU_ENGINE_VERSION, type TuEvent } from "@/lib/tu";

const raw = JSON.stringify({ v: 1, runId: "r", seed: "s", tiers: [{}, {}], taps: [{ p: "peek", at: 200 }], nickname: "n", expiresAt: "2099-01-01T00:00:00Z", score: 0 });

afterEach(() => vi.unstubAllGlobals());

describe("tu props (C8)", () => {
  const completed: TuEvent[] = [
    { type: "pack", tier: 0, slot: 0, points: 120, order: true },
    { type: "order", index: 0, tier: 1 },
  ];
  it("the order popup shows only points when a capped grant was skipped (no gain event)", () => {
    expect(orderCompleteText(90, completed)).toBe("订单完成 +90");
  });
  it.each([["peek", "偷看"], ["bag", "加个纸袋"], ["swap", "换订单"]] as const)("the order popup names an actually granted %s", (p, name) => {
    expect(orderCompleteText(90, [...completed, { type: "gain", p }])).toBe(`订单完成 +90　得到 ${name}`);
  });
  it("does not announce an order completion for a prop use without a reward", () => {
    expect(orderCompleteText(null, [{ type: "prop", p: "swap", left: 1 }, { type: "order", index: 0, tier: 1 }])).toBe("");
  });
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
      ["bb_tu_save_v2", "old"],
      ["bb_tu_save_v3", "old"],
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
  it("round-trips a 20000-entry local save within a 2 MiB storage budget; rejects 20001", () => {
    const save = { ...JSON.parse(raw), taps: Array.from({ length: 20_000 }, (_, i) => ({ id: i + 1, at: 604_800_000 - 20_000 * 500 + i * 500 })) };
    let stored: string | null = null;
    vi.stubGlobal("window", { localStorage: {
      length: 1,
      key: () => TU_SAVE_KEY,
      setItem: (_key: string, value: string) => {
        // Count UTF-16 storage conservatively, including the key.
        expect((value.length + TU_SAVE_KEY.length) * 2).toBeLessThan(2 * 1024 * 1024);
        stored = value;
      },
      getItem: () => stored,
    } });
    writeTuSave(save);
    expect(readTuSave()).toEqual(save);
    expect(parseTuSave(JSON.stringify({ ...save, taps: [...save.taps, { id: 0, at: 604_800_000 }] }))).toBeNull();
  });
  it("tolerates unavailable storage", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("unavailable"); } });
    expect(readTuSave()).toBeNull();
  });
});
