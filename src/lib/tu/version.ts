/** New runs only; never rewrite an existing run's seed. */
export const TU_ENGINE_VERSION = 6;
export type TuEngineVersion = 5 | 6;
const SEED_RE = /^v(\d+)\.[0-9a-f]+$/;

export function tuSeed(randomHex: string): string {
  return `v${TU_ENGINE_VERSION}.${randomHex}`;
}

/** Plain seeds predate versioning (v1). */
export function tuSeedVersion(seed: string): number {
  const match = SEED_RE.exec(seed);
  return match ? Number(match[1]) : 1;
}

/** Admission check for persisted runs and saves, shared by client and server. */
export function isSupportedTuSeed(seed: string): boolean {
  const version = tuSeedVersion(seed);
  return version === 5 || version === 6;
}

/** Bare labels remain available for local simulations; persisted seeds require admission. */
export function tuRulesVersion(seed: string): TuEngineVersion {
  if (isSupportedTuSeed(seed)) return tuSeedVersion(seed) as TuEngineVersion;
  if (/^v\d+\./.test(seed)) throw new RangeError("tu: unsupported seed version");
  return TU_ENGINE_VERSION;
}
