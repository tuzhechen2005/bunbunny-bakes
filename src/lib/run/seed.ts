import { RUN_ENGINE_VERSION, type RunStartMode } from "./types";

/** Pin replay rules in every new run's seed, using server-generated random hex. */
export function runSeed(randomHex: string, mode: RunStartMode = "normal"): string {
  return `v${RUN_ENGINE_VERSION}.${randomHex}${mode === "normal" ? "" : `.${mode}`}`;
}

/** RUN has no legacy unversioned runs; malformed or unversioned seeds are not replayable. */
export function runSeedVersion(seed: string): number | null {
  const match = /^v(\d+)\.[0-9a-f]+(?:\.(?:sprint|practice))?$/.exec(seed);
  return match ? Number(match[1]) : null;
}

export function runStartMode(seed: string): RunStartMode {
  return seed.endsWith(".sprint") ? "sprint" : seed.endsWith(".practice") ? "practice" : "normal";
}
