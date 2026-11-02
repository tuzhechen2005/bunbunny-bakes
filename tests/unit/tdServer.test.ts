import { expect, it } from 'vitest';
import { isTdSuspicious, tdTierCount } from '@/server/tdRules';
import { tdFinishSchema } from '@/server/td';
import { isLevelGame } from '@/server/gameLevels';
import { eligiblePrizeGames, TD_PRIZE_FROM_WEEK } from '@/lib/gamePrizePool';
it('TD uses level ranking and its deployment prize gate', () => {
  expect(isLevelGame('TD')).toBe(true);
  expect(eligiblePrizeGames('2026-12-06', 8)).not.toContain('TD');
  expect(eligiblePrizeGames(TD_PRIZE_FROM_WEEK, 0)).toContain('TD');
});
it('validates exact bounded action logs and tier snapshots', () => {
  const runId = crypto.randomUUID();
  expect(tdFinishSchema.safeParse({ runId, inputs: [{ tick: 0, type: 'place', slot: 10, tower: 'oven' }], endTick: 60 }).success).toBe(true);
  expect(tdFinishSchema.safeParse({ runId, inputs: [{ tick: 0, type: 'callWave', slot: -1 }], endTick: 60 }).success).toBe(true);
  for (const input of [{ tick: 0, type: 'place', slot: 11, tower: 'oven' }, { tick: 0, type: 'sell', slot: 1, tower: 'oven' }, { tick: 0, type: 'callWave', slot: 0 }]) {
    expect(tdFinishSchema.safeParse({ runId, inputs: [input], endTick: 60 }).success).toBe(false);
  }
  expect(tdFinishSchema.safeParse({ runId, inputs: [{ tick: 0, type: 'upgrade', slot: 0, branch: 'a' }], endTick: 60 }).success).toBe(true);
  expect(tdFinishSchema.safeParse({ runId, inputs: [{ tick: 0, type: 'upgrade', slot: 0, branch: 'c' }], endTick: 60 }).success).toBe(false);
  for (const input of [{tick:0,type:'switch',fork:0},{tick:0,type:'item',item:'bomb',x:100,y:200},{tick:0,type:'item',item:'bell'},{tick:0,type:'item',item:'slide',position:1600}]) expect(tdFinishSchema.safeParse({runId,inputs:[input],endTick:0}).success).toBe(true);
  expect(tdTierCount([{ id: 'bread' }])).toBe(1);
  expect(() => tdTierCount([])).toThrow();
});
it('flags machine-like cadence without flagging same-tick construction alone', () => {
  expect(isTdSuspicious([{ tick: 0 }, { tick: 0 }])).toBe(false);
  expect(isTdSuspicious(Array.from({length: 20}, (_, tick) => ({ tick })))).toBe(true);
  expect(isTdSuspicious([{ tick: 0 }, { tick: 60 }, { tick: 120 }])).toBe(false);
});
