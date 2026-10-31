import { RUN_ENGINE_VERSION } from "./types";

/** Pin replay rules in every new run's seed, using server-generated random hex. */
export function runSeed(randomHex: string): string {
  return `v${RUN_ENGINE_VERSION}.${randomHex}`;
}

/** RUN has no legacy unversioned runs; malformed or unversioned seeds are not replayable. */
export function runSeedVersion(seed: string): number | null {
  const match = /^v(\d+)\.[0-9a-f]+$/.exec(seed);
  return match ? Number(match[1]) : null;
}
