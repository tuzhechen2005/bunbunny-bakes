// Pure server policy helpers. The engine also supports 4/5 tiers for local simulations, but
// ranked runs require exactly six for comparable boards (S2, D135).
import type { M3TierInput } from "@/lib/m3";

export const M3_MIN_TIERS = 6;
export const M3_SUSPICIOUS_MEDIAN_GAP_MS = 400;

/** Never slice, sort, or reload today's configuration when replaying a stored run. */
export function m3TiersFromSnapshot(snapshot: unknown): M3TierInput[] {
  if (!Array.isArray(snapshot) || snapshot.length !== M3_MIN_TIERS) {
    throw new Error("bad m3 tiers snapshot");
  }
  const seen = new Set<string>();
  return snapshot.map((t) => {
    const o = t as { id?: unknown } | null;
    if (!o || typeof o.id !== "string" || !o.id || o.id === "big" || seen.has(o.id)) {
      throw new Error("bad m3 tiers snapshot");
    }
    seen.add(o.id);
    return { id: o.id };
  });
}

/** A review flag only; a full 30-move game is ordinary and remains eligible. */
export function isM3Suspicious(moves: readonly { at: number }[]): boolean {
  if (moves.length < 2) return false;
  const gaps = moves.slice(1).map((m, i) => m.at - moves[i].at).sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return median < M3_SUSPICIOUS_MEDIAN_GAP_MS;
}
