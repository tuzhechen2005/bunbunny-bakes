/** D184: versioned BIG state contract; physics and RNG payload remain unchanged. */
export const BIG_ENGINE_VERSION = 2;
export const bigSeed = (hex: string): string => `v${BIG_ENGINE_VERSION}.${hex}`;
export function bigSeedVersion(seed: string): number {
  const match = /^v(\d+)\.[0-9a-f]+$/.exec(seed);
  return match ? Number(match[1]) : 1;
}
