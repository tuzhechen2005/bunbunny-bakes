import type { GrabTierInput } from "@/lib/grab";

export const GRAB_MIN_TIERS = 3;
export const GRAB_SUSPICIOUS_MEDIAN_GAP_MS = 350;

/** Never slice, sort, or reload today's configuration when replaying a stored run. */
export function grabTiersFromSnapshot(snapshot: unknown): GrabTierInput[] {
  if (!Array.isArray(snapshot) || snapshot.length < GRAB_MIN_TIERS) {
    throw new Error("bad grab tiers snapshot");
  }
  const seen = new Set<string>();
  return snapshot.map((t) => {
    const o = t as { id?: unknown } | null;
    if (!o || typeof o.id !== "string" || !o.id || o.id === "big" || seen.has(o.id)) {
      throw new Error("bad grab tiers snapshot");
    }
    seen.add(o.id);
    return { id: o.id };
  });
}

/** A review flag only; rapid launch attempts remain eligible for owner review. */
export function isGrabSuspicious(launches: readonly number[]): boolean {
  if (launches.length < 2) return false;
  const gaps = launches.slice(1).map((m, i) => launchTime(m) - launchTime(launches[i])).sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return median < GRAB_SUSPICIOUS_MEDIAN_GAP_MS;
}

/** The wire log is ticks only; canonical millisecond times cannot disagree with it. */
export const launchTime = (tick: number): number => Math.round(tick * 1000 / 60);
export const validLaunchTime = (tick: number, at: number): boolean => Number.isSafeInteger(at) && at >= 0 && Math.round(at * 60 / 1000) === tick;
