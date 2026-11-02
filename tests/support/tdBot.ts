import { createRng } from "../../src/lib/game/rng";
import {
  createTdGame, TOWER_KINDS, towerStats, pathLength, pathPosition, distanceSquared,
  MAX_LEVEL_TICKS, SUBUNITS, type TdInput, type TdLevel, type TowerKind, type TdBranch, type TdOptions, type TdState,
} from "../../src/lib/td";

/** Public geometry/stats only; no future waves, RNG state, or private engine injection. */
function run(level: TdLevel, mode: "greedy" | "random", onlyKind?: TowerKind, itemsAllowed: TdOptions["itemsAllowed"] = {}, observe?: (state: TdState) => void) {
  const game = createTdGame({ level, itemsAllowed });
  const rng = createRng(`${level.seed}:td-bot`);
  const map = level.mapData;
  const inputs: TdInput[] = [];
  const coverage = (slot: number, kind: TowerKind, tier: number, branch?: TdBranch) => {
    const stats = towerStats(kind, tier, branch);
    let total = 0;
    const length = pathLength(map);
    for (let d = 0; d < length; d += 24 * SUBUNITS) {
      if (distanceSquared(map.slots[slot], pathPosition(map, d)) <= stats.range ** 2) total += (2 * length - d) / length;
    }
    return total;
  };
  const strength = (slot: number, kind: TowerKind, tier: number, branch?: TdBranch) => {
    const stats = towerStats(kind, tier, branch);
    return coverage(slot, kind, tier, branch) * (stats.damage * stats.strikes + stats.burn * 4 + stats.vulnerability * 2 + (kind === "freezer" ? 150 : kind === "pipingBag" ? 120 : 0)) * (kind === "whisk" ? (stats.splash > 100 ? 4 : 3) : kind === "oven" ? (stats.pierce ? 1.8 : 0.8) : 1) / Math.max(60 * Number(kind === "flourSifter"), stats.cooldown);
  };
  const values = map.slots.map((_, slot) => Object.fromEntries(TOWER_KINDS.map(kind => [kind,
    [0, 1, 2].map(tier => strength(slot, kind, tier)),
  ])) as Record<TowerKind, number[]>);
  const branchValues = map.slots.map((_, slot) => Object.fromEntries(TOWER_KINDS.map(kind => [kind,
    { a: strength(slot, kind, 2, "a"), b: strength(slot, kind, 2, "b") },
  ])) as Record<TowerKind, Record<TdBranch, number>>);
  function apply(input: TdInput) {
    if (!game.apply(input)) throw new Error("bot proposed an illegal action");
    inputs.push(input);
  }
  while (!game.over) {
    let state = game.state();
    if (mode === 'greedy') {
      if (itemsAllowed.bomb && level.number >= 2 && !state.itemsUsed.bomb && state.pests.length >= 8) {
        const target = [...state.pests].sort((a,b) =>
          state.pests.filter(p => distanceSquared(p,b) < 180**2).length - state.pests.filter(p => distanceSquared(p,a) < 180**2).length)[0];
        apply({tick:state.tick,type:'item',item:'bomb',x:target.x,y:target.y});
      }
      if (itemsAllowed.bell && level.number >= 6 && !state.itemsUsed.bell && state.pests.filter(p => p.carrying).length >= 3) apply({tick:state.tick,type:'item',item:'bell'});
      if (itemsAllowed.slide && level.number >= 10 && !state.itemsUsed.slide && state.pests.some(p => p.distance > pathLength(map)*0.6)) apply({tick:state.tick,type:'item',item:'slide',position:Math.floor(pathLength(map)*0.7)});
      for (const fork of map.features ?? []) if (fork.switchable && fork.branches) {
        const scores = fork.branches.map(branch => branch.reduce((score,p) => score+state.towers.filter(t => distanceSquared(t,p) <= towerStats(t.kind,t.level,t.branch).range**2).length,0));
        const best = scores[1] > scores[0] ? 1 : 0;
        if (state.switches[fork.id] !== best) apply({tick:state.tick,type:'switch',fork:fork.id});
      }
      state = game.state();
    }
    // Spend from a common 2 Hz observation cadence. Same-tick actions retain log order.
    for (let purchase = 0; purchase < 30; purchase++) {
      const candidates: { input: TdInput; cost: number; value: number }[] = [];
      for (let slot = 0; slot < map.slots.length; slot++) {
        const tower = state.towers.find(t => t.slot === slot);
        if (!tower) for (const kind of level.unlockedTowers) {
          if (onlyKind && kind !== onlyKind) continue;
          let value = values[slot][kind][0];
          if (kind === "flourSifter") {
            // Extra firing time plus vulnerability, discounted for partial overlap.
            value += state.towers.filter(t => t.kind !== "flourSifter" && distanceSquared(t, map.slots[slot]) < 400 ** 2)
              .reduce((sum, t) => sum + values[t.slot][t.kind][t.level], 0) * 0.65;
            if (state.towers.some(t => t.kind === "flourSifter" && distanceSquared(t, map.slots[slot]) < 340 ** 2)) value = 0;
          }
          // Diminishing role value: control, splash and armor coverage complement each other.
          value /= 1 + state.towers.filter(t => t.kind === kind).length * 1.5;
          const cost = towerStats(kind).cost;
          candidates.push({ input: { tick: state.tick, type: "place", slot, tower: kind }, cost, value: value / cost });
        } else if (tower.level < 2) {
          const cost = towerStats(tower.kind, tower.level + 1).cost;
          for (const branch of tower.level === 1 ? ["a", "b"] as const : [undefined]) {
            candidates.push({ input: { tick: state.tick, type: "upgrade", slot, ...(branch ? { branch } : {}) }, cost,
              value: ((branch ? branchValues[slot][tower.kind][branch] : values[slot][tower.kind][tower.level + 1]) - values[slot][tower.kind][tower.level]) / cost / (1 + state.towers.filter(t => t.kind === tower.kind).length * 1.5) });
          }
        }
      }
      if (mode === "greedy") {
        candidates.sort((a, b) => b.value - a.value);
        const best = candidates[0];
        if (!best || best.cost > state.coins || best.value <= 0) break;
        apply(best.input);
      } else {
        const affordable = candidates.filter(c => c.cost <= state.coins);
        if (!affordable.length) break;
        apply(affordable[rng.int(affordable.length)].input);
      }
      state = game.state();
    }
    if (state.awaitingStart || state.nextWaveTick !== null && state.pests.length === 0 && !state.spawning) {
      apply({ tick: state.tick, type: "callWave", slot: -1 });
    }
    const until = Math.min(MAX_LEVEL_TICKS, state.tick + 30);
    if (observe) {
      // Preserve the bot's purchase cadence while checking every simulation tick.
      for (let tick = state.tick + 1; tick <= until && !game.over; tick++) {
        const events = game.step(tick);
        // The live count can increase only on a spawn tick. Inspect its exact
        // snapshot rather than copying the whole state on every empty tick.
        if (events.some(event => event.type === "spawn")) observe(game.state());
      }
    } else game.step(until);
  }
  // Clear operation-local events so consumers compare simulation fields separately.
  game.step(MAX_LEVEL_TICKS);
  return { inputs, state: game.state() };
}

export const greedyTd = (level: TdLevel, itemsAllowed?: TdOptions["itemsAllowed"], observe?: (state: TdState) => void) => run(level, "greedy", undefined, itemsAllowed, observe);
export const singleTowerTd = (level: TdLevel, kind: TowerKind) => run(level, "greedy", kind);
export const randomTd = (level: TdLevel) => run(level, "random");

/** Disjoint windows can be used for tuning and held-out validation. */
export const tdBotWeeks = (count: number, offset = 0): string[] => Array.from({ length: count }, (_, i) =>
  new Date(Date.UTC(2026, 0, 5 + (offset + i) * 7)).toISOString().slice(0, 10));
