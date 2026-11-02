import { expect, it } from "vitest";
import { tdLevel, createTdGame, MAX_LEVEL_TICKS, towerStats, PREP_TICKS, WAVE_COUNT } from "@/lib/td";
import { greedyTd, randomTd, tdBotWeeks } from "../support/tdBot";
// V12.1 generic greedy reference: stronger spits punish its inconsistent AoE coverage.
// A separate mixed-build simulation measures the intended counter, without changing this bot.
const checkpoints = [[0,5,60],[0,10,100],[0,20,60],[100,5,35],[100,10,95],[100,20,50]]
  .map(([offset,level,target])=>({offset,level,target}));
it.each(checkpoints)("D181 L$level curve, week offset $offset", ({offset,level,target}) => {
  const runs=tdBotWeeks(20,offset).map(week=>greedyTd(tdLevel(week,level)));
  const rate=runs.filter(r=>r.state.passed).length * 100 / runs.length;
  process.stdout.write(`D181 ${JSON.stringify({offset,level,rate,samples:runs.length})}\n`);
  expect(rate).toBeGreaterThanOrEqual(target-10);expect(rate).toBeLessThanOrEqual(target+10);
  for(const run of runs) expect(run.state.inputsRejected).toBe(0);
},300000);
it('L1 rewards active building over 100 weeks without adding mechanics', () => {
  let greedy = 0, random = 0, single = 0;
  for (const [index, week] of tdBotWeeks(100).entries()) {
    const level = tdLevel(week, 1);
    expect(level.startCoins).toBeGreaterThanOrEqual(towerStats('rollingPin').cost);
    expect(level.startCoins).toBeLessThan(2 * towerStats('rollingPin').cost);
    expect(level.unlockedTowers).toEqual(['rollingPin']);
    expect(level.mapData.features ?? []).toHaveLength(0);
    for (const pest of level.waves.flatMap(w => w.pests)) {
      expect(pest.hp).toBeGreaterThan(2 * towerStats('rollingPin').damage);
      expect(pest.speed).toBe(pest.boss ? 8 : 24);
    }
    greedy += Number(greedyTd(level).state.passed);
    random += Number(randomTd(level).state.passed);
    const game = createTdGame({ level });
    expect(game.apply({ tick: 0, type: 'place', slot: index % 3, tower: 'rollingPin' })).toBe(true);
    expect(game.apply({ tick: 0, type: 'callWave', slot: -1 })).toBe(true);
    game.step(MAX_LEVEL_TICKS);
    expect(game.state().towers.map(tower => tower.level)).toEqual([0]);
    expect(game.state().inputsRejected).toBe(0);
    single += Number(game.passed);
  }
  process.stdout.write(`D11 L1 ${JSON.stringify({ greedy, random, single, samples: 100 })}\n`);
  expect(greedy).toBeGreaterThanOrEqual(95);
  expect(single).toBeLessThanOrEqual(20);
  expect(random).toBeGreaterThanOrEqual(25);
  expect(random).toBeLessThanOrEqual(60);
}, 300000);

it.each(['two pins', 'early upgrades'] as const)('L1 clears with %s over 100 weeks', strategy => {
  for (const week of tdBotWeeks(100)) {
    const game = createTdGame({ level: tdLevel(week, 1) });
    expect(game.apply({ tick: 0, type: 'place', slot: 2, tower: 'rollingPin' })).toBe(true);
    expect(game.apply({ tick: 0, type: 'callWave', slot: -1 })).toBe(true);
    while (!game.over) {
      const state = game.state();
      if (strategy === 'two pins' && state.towers.length === 1 && state.coins >= towerStats('rollingPin').cost) {
        expect(game.apply({ tick: state.tick, type: 'place', slot: 0, tower: 'rollingPin' })).toBe(true);
      }
      const tower = state.towers[0];
      if (strategy === 'early upgrades' && tower.level < 2 && state.coins >= towerStats('rollingPin', tower.level + 1).cost) {
        if (tower.level === 0) expect(state.lost).toBeLessThanOrEqual(2);
        expect(game.apply({ tick: state.tick, type: 'upgrade', slot: 2,
          ...(tower.level === 1 ? { branch: 'a' as const } : {}) })).toBe(true);
      }
      game.step(Math.min(MAX_LEVEL_TICKS, state.tick + 30));
    }
    expect(game.passed, week).toBe(true);
    // Two unupgraded pins can now leak the boss phase mice; an upgraded pin remains safer.
    expect(game.state().bread, week).toBeGreaterThanOrEqual(strategy === 'two pins' ? 1 : 2);
    expect(game.state().inputsRejected).toBe(0);
  }
}, 300000);

it.each(Array.from({ length: 30 }, (_, i) => i + 1))(
  'L%i budgets income at most 75% of full build and bounds unspent cash over 20 weeks', levelNumber => {
    for (const week of tdBotWeeks(20)) {
      const level = tdLevel(week, levelNumber);
      const fullBuildCost = level.mapData.slots.length * Math.max(...level.unlockedTowers.map(kind =>
        [0, 1, 2].reduce((sum, tier) => sum + towerStats(kind, tier).cost, 0)));
      // First call is free; each subsequent call can earn at most the full prep bonus.
      const maxBonus = (WAVE_COUNT - 1) * Math.floor(PREP_TICKS / 60) * 3;
      const possibleIncome = (levelNumber >= 5 ? 24 : 0) + level.startCoins + maxBonus + level.clutter!.reduce((sum,c) => sum+c.reward,0)
        + level.waves.flatMap(w => w.pests).reduce((sum, pest) => sum + pest.bounty, 0);
      expect(possibleIncome, `${week} L${levelNumber}`).toBeLessThanOrEqual(fullBuildCost * 0.75);
      const run = greedyTd(level);
      // This bot never sells, so placed/upgrade investment plus cash is earned income,
      // including actual call bonuses and excluding bounties on escaped pests.
      expect(run.inputs.some(input => input.type === 'sell')).toBe(false);
      const spent = run.state.towers.reduce((sum, tower) => sum + tower.spent, 0);
      const utilization = spent / (spent + run.state.coins);
      if (run.state.passed || utilization >= 0.7) expect(utilization, `${week} L${levelNumber}`).toBeGreaterThanOrEqual(0.7);
      else {
        // A fast swarm can end a loss just short of the upgrade being saved for.
        // Retain the 70% clear guard; losses may hold less than one tier-2 purchase.
        const purchase = Math.max(...level.unlockedTowers.map(kind=>towerStats(kind,2).cost));
        expect(run.state.coins, `${week} L${levelNumber}`).toBeLessThan(purchase);
      }
      expect(run.state.inputsRejected).toBe(0);
    }
  }, 300000,
);

// Cover each onboarding level, the late-game count ceiling and saturated tuning.
it.each([...Array.from({ length: 25 }, (_, i) => i + 1), 50, 100, 1000])(
  'L%i stays within the live-pest cap across 20 weeks', (level) => {
    const cap = 16;
    for (const week of tdBotWeeks(20)) {
      let peak = 0;
      const run = greedyTd(tdLevel(week, level), {}, state => {
        peak = Math.max(peak, state.pests.length);
      });
      expect(peak, `${week} L${level}`).toBeLessThanOrEqual(cap);
      expect(peak).toBeGreaterThan(0);
      expect(run.state.inputsRejected).toBe(0);
    }
  }, 300000,
);
