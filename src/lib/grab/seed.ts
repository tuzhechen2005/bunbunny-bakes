import { GRAB_ENGINE_VERSION } from "./types";

/** Pin replay rules in every new run's seed, using server-generated random hex. */
export function grabSeed(randomHex: string): string {
  return `v${GRAB_ENGINE_VERSION}.${randomHex}`;
}

/** GRAB has no legacy unversioned runs; malformed or unversioned seeds are not replayable. */
export function grabSeedVersion(seed: string): number | null {
  const match = /^v(\d+)\.[0-9a-f]+$/.exec(seed);
  return match ? Number(match[1]) : null;
}
