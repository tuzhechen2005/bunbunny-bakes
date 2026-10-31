import { createRng } from "../game/rng";
import { PESTS } from "./balance";
import { TD_ENGINE_VERSION, WAVE_COUNT, type PestKind, type TdLevel, type TdWave } from "./types";

/** Validate a Gregorian Monday without clocks, time zones, or Date parsing. */
function validWeekKey(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1 || m < 1 || m > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d < 1 || d > months[m - 1]) return false;
  const prev = y - 1;
  const days = 365 * prev + Math.floor(prev / 4) - Math.floor(prev / 100) + Math.floor(prev / 400)
    + months.slice(0, m - 1).reduce((a, b) => a + b, 0) + d - 1;
  return days % 7 === 0; // 0001-01-01 was Monday.
}

export function tdSeed(weekKey: string, n: number): string {
  if (!validWeekKey(weekKey)) throw new RangeError("td: weekKey must be a Gregorian Monday YYYY-MM-DD");
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError("td: level must be a positive safe integer");
  return `v${TD_ENGINE_VERSION}.td.${weekKey}.${n}`;
}

export function tdSeedVersion(seed: string): number | null {
  if (typeof seed !== "string") return null;
  const match = /^v([1-9]\d*)\.td\.(\d{4}-\d{2}-\d{2})\.([1-9]\d*)$/.exec(seed);
  if (!match || !validWeekKey(match[2]) || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[3]))) return null;
  return Number(match[1]);
}

/** No owner/run randomness: everyone gets exactly this week's numbered level. */
export function tdLevel(weekKey: string, n: number): TdLevel {
  const seed = tdSeed(weekKey, n);
  const rng = createRng(seed);
  // Saturate physical tuning at L1000 to keep even MAX_SAFE_INTEGER levels bounded.
  const difficulty = Math.min(n - 1, 999);
  const hpGrowth = 87 + Math.floor(Math.min(10, Math.max(0, difficulty - 9)) * 25 / 10);
  const pressure = 85 + rng.int(31);
  const kinds: PestKind[] = ["ant", "mouse"];
  if (n >= 4) kinds.push("sparrow");
  if (n >= 8) kinds.push("beetle");
  const waves = Array.from({ length: WAVE_COUNT }, (_, wave) => {
    const count = Math.min(96, 9 + difficulty + wave * 3 + rng.int(3));
    const result: TdWave = {
      interval: Math.max(18, 48 - Math.floor(difficulty / 2) - wave * 2),
      pests: Array.from({ length: count }, (_, index) => {
        // Guarantee new kinds are visible, even in an unusually skewed weekly draw.
        const kind = index < kinds.length ? kinds[index] : kinds[rng.int(kinds.length)];
        const b = PESTS[kind];
        return {
          ...b,
          hp: Math.max(1, Math.floor(b.hp * (100 + difficulty * hpGrowth + wave * 12) * pressure / 10000)),
          speed: Math.floor(b.speed * (100 + Math.min(150, difficulty * 3)) / 100),
        };
      }),
    };
    if (wave === WAVE_COUNT - 1) result.pests.push({
      ...PESTS.mouse, boss: true, hp: 600 + difficulty * 180,
      speed: 20, armor: 8, bounty: 80,
    });
    return result;
  });
  // Late levels need a viable opening defense before bounty income can sustain upgrades.
  // Keep L1–L10 unchanged; ramp through L20, then let the original pest curve keep growing.
  const startCoins = 300 + Math.min(10, Math.max(0, difficulty - 9)) * 102;
  return { seed, weekKey, number: n, map: Math.floor((n - 1) / 4) % 3, startCoins, waves };
}

export function tdLevelFromSeed(seed: string): TdLevel {
  if (tdSeedVersion(seed) !== TD_ENGINE_VERSION) throw new RangeError("td: unsupported or malformed seed");
  const parts = seed.split(".");
  const level = tdLevel(parts[2], Number(parts[3]));
  if (level.seed !== seed) throw new RangeError("td: noncanonical seed");
  return level;
}
