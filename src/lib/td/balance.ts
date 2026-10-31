import type { PestKind, TdPestSpec, TowerKind, TdBranch } from "./types";

export const PESTS: Readonly<Record<PestKind, Readonly<TdPestSpec>>> = Object.freeze({
  ant: Object.freeze({ kind: "ant", hp: 28, speed: 48, bounty: 8, armor: 0 }),
  mouse: Object.freeze({ kind: "mouse", hp: 65, speed: 34, bounty: 12, armor: 0 }),
  sparrow: Object.freeze({ kind: "sparrow", hp: 42, speed: 56, bounty: 10, armor: 0 }),
  beetle: Object.freeze({ kind: "beetle", hp: 145, speed: 23, bounty: 18, armor: 6 }),
});

export interface TowerStats {
  cost: number; range: number; damage: number; cooldown: number;
  flight: number; splash: number; slowPercent: number; strikes: number; knockback: number; burn: number; pierce: number; chipDps: number; linger: number;
}
const BASE: Record<TowerKind, Omit<TowerStats, "strikes" | "knockback" | "burn" | "pierce" | "chipDps" | "linger">> = {
  rollingPin: { cost: 60, range: 165, damage: 18, cooldown: 26, flight: 6, splash: 0, slowPercent: 0 },
  flourSifter: { cost: 80, range: 170, damage: 0, cooldown: 0, flight: 0, splash: 0, slowPercent: 40 },
  whisk: { cost: 100, range: 150, damage: 22, cooldown: 48, flight: 10, splash: 85, slowPercent: 0 },
  oven: { cost: 150, range: 300, damage: 95, cooldown: 110, flight: 24, splash: 0, slowPercent: 0 },
};
export const TOWER_KINDS: readonly TowerKind[] = Object.freeze(["rollingPin", "flourSifter", "whisk", "oven"]);

/** level 0 = newly placed, 1/2 = upgrades. Returns a fresh, safe-to-edit value. */
export function towerStats(kind: TowerKind, level = 0, branch?: TdBranch | null): TowerStats {
  if (!TOWER_KINDS.includes(kind) || !Number.isInteger(level) || level < 0 || level > 2) throw new RangeError("td: bad tower");
  const b = BASE[kind];
  const stats = {
    ...b, chipDps: kind === "flourSifter" ? [6, 10, 16][level] : 0, linger: 0, strikes: 1, knockback: 0, burn: 0, pierce: 0, cost: Math.floor(b.cost * [100, 125, 165][level] / 100),
    range: b.range + 15 * level, damage: Math.floor(b.damage * [100, 175, 290][level] / 100),
    cooldown: Math.floor(b.cooldown * [100, 90, 80][level] / 100),
    slowPercent: b.slowPercent ? b.slowPercent + 10 * level : 0,
  };
  if (level === 2 && branch) {
    if (kind === "rollingPin") { if (branch === "a") stats.strikes = 2; else stats.knockback = 48 * 16; }
    if (kind === "flourSifter") { if (branch === "a") { stats.slowPercent = 65; stats.linger = 60; } else stats.range += 110; }
    if (kind === "whisk") { if (branch === "a") stats.splash = 140; else stats.cooldown = 24; }
    if (kind === "oven") { if (branch === "a") stats.burn = 16; else { stats.range += 100; stats.pierce = 2; } }
  }
  return stats;
}
