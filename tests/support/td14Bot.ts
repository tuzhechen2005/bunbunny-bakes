import { createRng } from '../../src/lib/game/rng';
import { createTdGame, distanceSquared, pathLength, pathPosition, towerStats, MAX_LEVEL_TICKS, SUBUNITS, type TdInput, type TdLevel } from '../../src/lib/td';

/** Novice: coarse route coverage with seeded 25% preference noise, three pins,
 * then at most three upgrades. One purchase per 1–2 seconds; no items, sales,
 * clutter rewards, early-call income, future-wave knowledge or boss responses.
 * Pins are available at every level; choosing familiar pins is intentional.
 */
export function noviceTd(level: TdLevel) {
  const game = createTdGame({level});
  const rng = createRng(`${level.seed}:novice`);
  const inputs: TdInput[] = [];
  const slots = level.mapData.slots.map((point, slot) => {
    let coverage = 0;
    for (let d = 0; d < pathLength(level.mapData); d += 48 * SUBUNITS) {
      if (distanceSquared(point, pathPosition(level.mapData, d)) <= towerStats('rollingPin').range ** 2) coverage++;
    }
    return {slot, score: coverage * (0.75 + rng.int(51) / 100)};
  }).sort((a,b) => b.score - a.score).map(s => s.slot);
  let upgrades = 0;
  const apply = (input: TdInput) => {
    if (!game.apply(input)) throw new Error('illegal novice input');
    inputs.push(input);
  };
  // The unlimited build phase permits the two affordable opening purchases.
  for (const slot of slots.slice(0,2)) if (game.state().coins >= towerStats('rollingPin').cost) {
    apply({tick:0,type:'place',slot,tower:'rollingPin'});
  }
  apply({tick:0,type:'callWave',slot:-1});
  while (!game.over) {
    game.step(Math.min(MAX_LEVEL_TICKS, game.state().tick + 60 + rng.int(61)));
    if (game.over) break;
    const state = game.state();
    if (state.towers.length < 3 && state.coins >= towerStats('rollingPin').cost) {
      apply({tick:state.tick,type:'place',slot:slots[state.towers.length],tower:'rollingPin'});
    } else if (upgrades < 3) {
      const tower = state.towers.filter(t => t.level < 2).sort((a,b) => a.level-b.level || slots.indexOf(a.slot)-slots.indexOf(b.slot))[0];
      if (tower && state.coins >= towerStats(tower.kind,tower.level+1).cost) {
        apply({tick:state.tick,type:'upgrade',slot:tower.slot,...(tower.level === 1 ? {branch:'a' as const} : {})});
        upgrades++;
      }
    }
  }
  return {inputs,state:game.state()};
}
