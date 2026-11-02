import { expect, it } from 'vitest';
import { createTdGame, MAX_LEVEL_TICKS, replayTd, tdLevel, type TdInput } from '@/lib/td';

const level = tdLevel('2026-10-26', 1);
it('allows unlimited building, starts once without a bonus, and replays the delayed start', () => {
  const game = createTdGame({ level });
  const delay = MAX_LEVEL_TICKS * 1000000;
  expect(game.step(delay)).toEqual([]);
  expect(game.state()).toMatchObject({ tick: delay, awaitingStart: true, startedTick: null, nextWaveTick: null, wave: 0, over: false, pests: [] });
  const inputs: TdInput[] = [
    { tick: delay, type: 'place', slot: 0, tower: 'rollingPin' },
    { tick: delay, type: 'callWave', slot: -1 },
    { tick: delay, type: 'callWave', slot: -1 },
  ];
  expect(game.apply(inputs[0])).toBe(true);
  expect(replayTd({ level }, [inputs[0]])).toMatchObject({ awaitingStart: true, startedTick: null, wave: 0, over: false });
  const coins = game.state().coins;
  expect(game.apply(inputs[1])).toBe(true);
  expect(game.state()).toMatchObject({ awaitingStart: false, startedTick: delay, coins, wave: 1 });
  expect(game.state().events).toContainEqual({ type: 'waveStart', tick: delay, wave: 1, targetTier: 5, bonus: 0 });
  expect(game.apply(inputs[2])).toBe(false);
  game.step(delay + 1);
  expect(game.state().pests).toHaveLength(1);
  expect(replayTd({ level }, inputs, delay + 1)).toEqual(game.state());
});

it('counts timeout from the first start and rejects post-terminal replay inputs', async () => {
  const { vi } = await import('vitest');
  const levels = await import('@/lib/td/level');
  const stalled = structuredClone(level);
  stalled.waves.forEach(wave => wave.pests.forEach(pest => { pest.speed = 0; }));
  const spy = vi.spyOn(levels, 'tdLevelFromSeed').mockReturnValue(stalled);
  try {
    const delay = MAX_LEVEL_TICKS * 2;
    const input: TdInput = { tick: delay, type: 'callWave', slot: -1 };
    const game = createTdGame({ level });
    game.apply(input);
    game.step(delay + MAX_LEVEL_TICKS - 1);
    expect(game.over).toBe(false);
    expect(game.step(delay + MAX_LEVEL_TICKS)).toContainEqual({ type: 'over', tick: delay + MAX_LEVEL_TICKS, passed: false, reason: 'timeout' });
    expect({ ...replayTd({ level }, [input]), events: [] }).toEqual({ ...game.state(), events: [] });
    expect(() => replayTd({ level }, [input, { tick: delay + MAX_LEVEL_TICKS, type: 'sell', slot: 0 }])).toThrow(/game over/);
  } finally { spy.mockRestore(); }
});
