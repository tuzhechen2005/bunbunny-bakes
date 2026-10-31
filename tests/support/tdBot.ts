import { createRng } from "../../src/lib/game/rng";
import {
  createTdGame, TD_MAPS, TOWER_KINDS, towerStats, pathLength, pathPosition, distanceSquared,
  MAX_LEVEL_TICKS, SUBUNITS, type TdInput, type TdLevel, type TowerKind,
} from "../../src/lib/td";

/** Public geometry/stats only; no future waves, RNG state, or private engine injection. */
function run(level: TdLevel, mode: "greedy" | "random") {
  const game = createTdGame({ level });
  const rng = createRng(`${level.seed}:td-bot`);
  const map = TD_MAPS[level.map];
  const inputs: TdInput[] = [];
  const coverage = (slot: number, kind: TowerKind, tier: number) => {
    const stats = towerStats(kind, tier);
    let total = 0;
    const length = pathLength(map);
    for (let d = 0; d < length; d += 24 * SUBUNITS) {
      if (distanceSquared(map.slots[slot], pathPosition(map, d)) <= stats.range ** 2) total += (2 * length - d) / length;
    }
    return total;
  };
  const strength = (slot: number, kind: TowerKind, tier: number) => {
    const stats = towerStats(kind, tier);
    return coverage(slot, kind, tier) * stats.damage * (kind === "whisk" ? 3 : kind === "oven" ? 0.8 : 1) / Math.max(1, stats.cooldown);
  };
  const values = map.slots.map((_, slot) => Object.fromEntries(TOWER_KINDS.map(kind => [kind,
    [0, 1, 2].map(tier => strength(slot, kind, tier)),
  ])) as Record<TowerKind, number[]>);
  function apply(input: TdInput) {
    if (!game.apply(input)) throw new Error("bot proposed an illegal action");
    inputs.push(input);
  }
  while (!game.over) {
    let state = game.state();
    // Spend from a common 2 Hz observation cadence. Same-tick actions retain log order.
    for (let purchase = 0; purchase < 30; purchase++) {
      const candidates: { input: TdInput; cost: number; value: number }[] = [];
      for (let slot = 0; slot < map.slots.length; slot++) {
        const tower = state.towers.find(t => t.slot === slot);
        if (!tower) for (const kind of TOWER_KINDS) {
          let value = values[slot][kind][0];
          if (kind === "flourSifter") {
            // Approximate the extra firing time for nearby ground-targeting towers.
            value = state.towers.filter(t => t.kind !== "flourSifter" && distanceSquared(t, map.slots[slot]) < 240 ** 2)
              .reduce((sum, t) => sum + values[t.slot][t.kind][t.level], 0) * 0.2;
            if (state.towers.some(t => t.kind === "flourSifter")) value = 0;
          }
          const cost = towerStats(kind).cost;
          candidates.push({ input: { tick: state.tick, type: "place", slot, tower: kind }, cost, value: value / cost });
        } else if (tower.level < 2) {
          const cost = towerStats(tower.kind, tower.level + 1).cost;
          candidates.push({ input: { tick: state.tick, type: "upgrade", slot }, cost,
            value: (values[slot][tower.kind][tower.level + 1] - values[slot][tower.kind][tower.level]) / cost });
        }
      }
      if (mode === "greedy") {
        candidates.sort((a, b) => b.value - a.value);
        const best = candidates.find(c => c.cost <= state.coins);
        if (!best || best.value <= 0) break;
        apply(best.input);
      } else {
        const affordable = candidates.filter(c => c.cost <= state.coins);
        if (!affordable.length) break;
        apply(affordable[rng.int(affordable.length)].input);
      }
      state = game.state();
    }
    if (state.nextWaveTick !== null && state.pests.length === 0 && !state.spawning) {
      apply({ tick: state.tick, type: "callWave", slot: -1 });
    }
    game.step(Math.min(MAX_LEVEL_TICKS, state.tick + 30));
  }
  // Clear operation-local events so consumers compare simulation fields separately.
  game.step(MAX_LEVEL_TICKS);
  return { inputs, state: game.state() };
}

export const greedyTd = (level: TdLevel) => run(level, "greedy");
export const randomTd = (level: TdLevel) => run(level, "random");

/** Disjoint windows can be used for tuning and held-out validation. */
export const tdBotWeeks = (count: number, offset = 0): string[] => Array.from({ length: count }, (_, i) =>
  new Date(Date.UTC(2026, 0, 5 + (offset + i) * 7)).toISOString().slice(0, 10));
