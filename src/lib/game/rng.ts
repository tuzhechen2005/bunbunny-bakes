// Deterministic PRNG for the game engine (sfc32 seeded through an xmur3-style string hash).
// Only 32-bit integer maths (Math.imul, shifts, adds), so V8 and JavaScriptCore agree bit for bit.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

function hashSeed(seed: string): [number, number, number, number] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    out.push(h >>> 0);
    h = (h + 0x9e3779b9) | 0;
  }
  return out as [number, number, number, number];
}

export function createRng(seed: string): Rng {
  const s = hashSeed(String(seed));
  let a = s[0] | 0;
  let b = s[1] | 0;
  let c = s[2] | 0;
  let d = s[3] | 0;
  const u32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) u32(); // warm up
  return {
    next: () => u32() / 4294967296,
    int: (n: number) => Math.floor((u32() / 4294967296) * n),
  };
}
