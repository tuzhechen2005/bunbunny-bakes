import { describe, expect, it } from "vitest";
import { grabSeed, grabSeedVersion } from "@/lib/grab/seed";
import { GRAB_ENGINE_VERSION } from "@/lib/grab";
import { grabTiersFromSnapshot, isGrabSuspicious, launchTime, validLaunchTime } from "@/server/grabRules";
describe("GRAB policy", () => {
  it("pins seeds", () => { expect(grabSeedVersion(grabSeed("ab12"))).toBe(GRAB_ENGINE_VERSION); expect(grabSeedVersion("legacy")).toBeNull(); });
  it("keeps every snapshot tier in order", () => { const tiers = Array.from({length: 8}, (_, i) => ({id: String(i)})); expect(grabTiersFromSnapshot(tiers)).toEqual(tiers); expect(() => grabTiersFromSnapshot(tiers.slice(0, 2))).toThrow(); expect(() => grabTiersFromSnapshot([{id:"a"},{id:"a"},{id:"b"}])).toThrow(); });
  it("flags strictly below 350ms", () => { expect(isGrabSuspicious([0,20,40])).toBe(true); expect(isGrabSuspicious([0,21,42])).toBe(false); expect(isGrabSuspicious([])).toBe(false); });
  it("round trips every tick through integer milliseconds", () => { for(let tick=0;tick<=6000;tick++) expect(validLaunchTime(tick,launchTime(tick))).toBe(true); expect(validLaunchTime(60,900)).toBe(false); });
});
