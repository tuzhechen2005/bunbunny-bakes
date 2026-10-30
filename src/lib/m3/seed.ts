import { M3_ENGINE_VERSION } from "./types";

/** Pin replay rules in every new run's seed, using server-generated random hex. */
export function m3Seed(randomHex: string): string {
  return `v${M3_ENGINE_VERSION}.${randomHex}`;
}

/** M3 has no legacy unversioned runs; malformed or unversioned seeds are not replayable. */
export function m3SeedVersion(seed: string): number | null {
  const match = /^v(\d+)\.[0-9a-f]+$/.exec(seed);
  return match ? Number(match[1]) : null;
}
