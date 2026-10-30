import { describe, expect, it } from "vitest";
import { MAX_MOVES, M3_ENGINE_VERSION, m3Seed, m3SeedVersion } from "@/lib/m3";
import { isM3Suspicious, M3_MIN_TIERS, M3_SUSPICIOUS_MEDIAN_GAP_MS, m3TiersFromSnapshot } from "@/server/m3Rules";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));
const times = (gaps: number[]) => {
  let at = 0;
  return [{ at }, ...gaps.map((gap) => ({ at: at += gap }))];
};

describe("M3 run helpers", () => {
  it("embeds the engine version and rejects unversioned/malformed seeds", () => {
    expect(m3Seed("abcdef")).toBe(`v${M3_ENGINE_VERSION}.abcdef`);
    expect(m3SeedVersion(m3Seed("abcdef"))).toBe(M3_ENGINE_VERSION);
    expect(m3SeedVersion("v99.abcdef")).toBe(99);
    for (const seed of ["abcdef", "", "v1.", "v1.nohex"]) expect(m3SeedVersion(seed)).toBeNull();
  });

  it("requires exactly six snapshot ids and preserves their exact order", () => {
    expect(M3_MIN_TIERS).toBe(6);
    const snapshot = [...tiers].reverse().map((t) => ({ ...t, name: "bread" }));
    expect(m3TiersFromSnapshot(snapshot)).toEqual([...tiers].reverse());
    for (const bad of [null, {}, [], tiers.slice(0, 5), [...tiers, { id: "extra" }],
      [...tiers.slice(1), { id: "big" }], [...tiers.slice(1), { id: "" }],
      [...tiers.slice(1), { id: 1 }], [...tiers.slice(1), null], [...tiers.slice(1), tiers[1]]]) {
      expect(() => m3TiersFromSnapshot(bad)).toThrow("bad m3 tiers snapshot");
    }
  });

  it("flags only median gaps below 400 ms, including the even median boundary", () => {
    expect(M3_SUSPICIOUS_MEDIAN_GAP_MS).toBe(400);
    expect(isM3Suspicious([])).toBe(false);
    expect(isM3Suspicious([{ at: 0 }])).toBe(false);
    expect(isM3Suspicious(times([399]))).toBe(true);
    expect(isM3Suspicious(times([400]))).toBe(false);
    expect(isM3Suspicious(times([200, 600]))).toBe(false);
    expect(isM3Suspicious(times([200, 598]))).toBe(true);
    expect(isM3Suspicious(times([900, 200, 300]))).toBe(true);
    expect(isM3Suspicious(times(Array(MAX_MOVES - 1).fill(500)))).toBe(false);
  });
});
