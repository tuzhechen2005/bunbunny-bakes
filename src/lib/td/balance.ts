import type { PestKind, TdPestSpec, TowerKind } from "./types";

export const PESTS: Readonly<Record<PestKind, Readonly<TdPestSpec>>> = Object.freeze({
  ant: Object.freeze({ kind: "ant", hp: 28, speed: 48, bounty: 8, armor: 0 }),
  mouse: Object.freeze({ kind: "mouse", hp: 65, speed: 34, bounty: 12, armor: 0 }),
  sparrow: Object.freeze({ kind: "sparrow", hp: 42, speed: 56, bounty: 10, armor: 0 }),
  beetle: Object.freeze({ kind: "beetle", hp: 145, speed: 23, bounty: 18, armor: 6 }),
});

export interface TowerStats {
  cost: number; range: number; damage: number; cooldown: number;
  flight: number; splash: number; slowPercent: number;
}
const BASE: Record<TowerKind, TowerStats> = {
  rollingPin: { cost: 60, range: 165, damage: 18, cooldown: 26, flight: 6, splash: 0, slowPercent: 0 },
  flourSifter: { cost: 80, range: 170, damage: 0, cooldown: 0, flight: 0, splash: 0, slowPercent: 30 },
  whisk: { cost: 100, range: 150, damage: 22, cooldown: 48, flight: 10, splash: 85, slowPercent: 0 },
  oven: { cost: 150, range: 300, damage: 95, cooldown: 110, flight: 24, splash: 0, slowPercent: 0 },
};
export const TOWER_KINDS: readonly TowerKind[] = Object.freeze(["rollingPin", "flourSifter", "whisk", "oven"]);

/** level 0 = newly placed, 1/2 = upgrades. Returns a fresh, safe-to-edit value. */
export function towerStats(kind: TowerKind, level = 0): TowerStats {
  if (!TOWER_KINDS.includes(kind) || !Number.isInteger(level) || level < 0 || level > 2) throw new RangeError("td: bad tower");
  const b = BASE[kind];
  return {
    ...b, cost: Math.floor(b.cost * [100, 125, 165][level] / 100),
    range: b.range + 15 * level, damage: Math.floor(b.damage * [100, 175, 290][level] / 100),
    cooldown: Math.floor(b.cooldown * [100, 90, 80][level] / 100),
    slowPercent: b.slowPercent ? b.slowPercent + 10 * level : 0,
  };
}
