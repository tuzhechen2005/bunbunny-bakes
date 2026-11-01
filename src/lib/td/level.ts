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
  const hpGrowth = 50 + Math.floor(Math.min(10, Math.max(0, difficulty - 9)) * 14 / 10);
  // Front-load the jump into mixed swarms; taper that onboarding pressure as
  // enemy count, movement speed and reduced bounties take over later.
  const earlyPressure = n < 10 ? Math.floor(Math.min(difficulty, 2) * 300 * (10 - n) / 7) : 0;
  const pressure = 85 + rng.int(31);
  // Compensate for the curriculum's species and the rotation's firing windows.
  // Interpolate anchors so adjacent levels do not acquire arbitrary HP cliffs.
  const anchors = [
    [1, 100], [2, 110], [3, 125], [4, 120], // Three runs: learn each threat.
    [5, 115], [8, 100], // Four runs: introduce shells, then build pressure.
    [9, 80], [10, 90], [11, 88], [12, 84], // Five runs: short-range towers cover both neighbors.
    [13, 100], [16, 100], // Return to wider gaps with a mature enemy mix.
    [17, 84], [18, 86], [20, 88], // Four-run reprise; economy now funds combos.
  ];
  const upper = anchors.findIndex(([level]) => level >= n);
  const highIndex = upper < 0 ? anchors.length - 1 : upper;
  const hi = anchors[highIndex];
  const lo = anchors[Math.max(0, upper < 0 ? highIndex : highIndex - 1)];
  const layoutPressure = hi[0] === lo[0] ? hi[1]
    : lo[1] + Math.floor((hi[1] - lo[1]) * (n - lo[0]) / (hi[0] - lo[0]));
  const kinds: PestKind[] = n === 1 ? ["ant"] : n === 2 ? ["mouse"] : ["ant", "mouse"];
  if (n >= 4) kinds.push("sparrow");
  if (n >= 5) kinds.push("beetle");
  const waves = Array.from({ length: WAVE_COUNT }, (_, wave) => {
    // Five beats: demonstration, pressure, combination, recovery, finale.
    const count = Math.floor(Math.min(96, 9 + Math.floor(difficulty * 3 / 2) + [0, 3, 6, 2, 12][wave] + rng.int(3)) * (n <= 5 ? 70 : 100) / 100);
    const result: TdWave = {
      interval: Math.max(18, [54, 44, 40, 60, 38][wave] - Math.floor(difficulty / 2)),
      pests: Array.from({ length: count }, (_, index) => {
        // Guarantee new kinds are visible, even in an unusually skewed weekly draw.
        const draw = rng.int(kinds.length);
        // Open with the lesson, then alternate short readable squads. Later
        // finales interleave speed and armor instead of one homogeneous train.
        const kind = index < kinds.length ? kinds[index]
          : wave === 0 ? kinds[Math.floor(index / 3) % kinds.length]
          : wave === 2 || wave === 4 ? kinds[index % kinds.length] : kinds[draw];
        const b = PESTS[kind];
        return {
          ...b,
          // Harden shells gradually after their L5 introduction. Low-health,
          // high-armor beetles counter double pins; oven bursts and flour support
          // remain efficient while fast, unarmored escorts punish oven-only play.
          armor: kind === 'beetle' ? Math.min(54, 6 + Math.max(0, n - 5) * 10) : b.armor,
          bounty: Math.max(3, b.bounty + (n <= 3 ? 1 : 0) - Math.min(4, Math.floor(difficulty / 3))),
          hp: Math.max(1, Math.floor(b.hp * (100 + difficulty * hpGrowth + earlyPressure + wave * 12) * pressure * layoutPressure * (kind === 'beetle' ? 20 : 100) / 100000000)),
          speed: Math.floor(b.speed * (100 + Math.min(150, difficulty * 3)) * 80 / 10000),
        };
      }),
    };
    if (wave === WAVE_COUNT - 1) result.pests.push({
      ...PESTS.mouse, boss: true, hp: n <= 3 ? 400 + difficulty * 120 : 600 + difficulty * 180,
      speed: 16, armor: n <= 3 ? 4 : 8, bounty: 80,
    });
    return result;
  });
  // New control/support mechanics replace the old large late opening subsidy.
  const startCoins = n <= 5 ? 340 : 240 + Math.min(10, Math.max(0, n - 10)) * 58;
  return { seed, weekKey, number: n, map: Math.floor((n - 1) / 4) % 3, startCoins, waves };
}

export function tdLevelFromSeed(seed: string): TdLevel {
  if (tdSeedVersion(seed) !== TD_ENGINE_VERSION) throw new RangeError("td: unsupported or malformed seed");
  const parts = seed.split(".");
  const level = tdLevel(parts[2], Number(parts[3]));
  if (level.seed !== seed) throw new RangeError("td: noncanonical seed");
  return level;
}
