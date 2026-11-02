import { expect, it } from 'vitest';
import { tdLevel } from '@/lib/td';
import { mixedTd, singleTowerTd, tdBotWeeks } from '../support/tdBot';
import { measureTdSpitRun } from '../support/tdSpitMetrics';

it.each([5,10])('L%i rewards deliberate splash/flour overlap over pin-only damage', n => {
  const losses={single:0,mixed:0};
  for (const week of tdBotWeeks(4,200)) {
    const level=tdLevel(week,n);
    for (const strategy of ['single','mixed'] as const) {
      const run=strategy==='single'?singleTowerTd(level,'rollingPin'):mixedTd(level);
      const measured=measureTdSpitRun(level,run);
      expect(measured.win).toBe(true);
      expect(measured.spits).toHaveLength(2);
      expect(measured.boss).toBeGreaterThanOrEqual(20);
      expect(measured.boss).toBeLessThanOrEqual(30);
      losses[strategy]+=measured.spits.reduce((a,b)=>a+b,0);
    }
  }
  expect(losses.single/8).toBeGreaterThanOrEqual(1);
  expect(losses.single/8).toBeLessThanOrEqual(3);
  expect(losses.mixed).toBe(0);
},60000);

it('L20 preserves late spit pressure while a mixed encounter typically resolves within 30 seconds', () => {
  const single:number[]=[], mixed:number[]=[], encounters:number[]=[];
  for (const week of tdBotWeeks(20,300)) {
    const level=tdLevel(week,20);
    const pinRun=measureTdSpitRun(level,singleTowerTd(level,'rollingPin'));
    const mixedRun=measureTdSpitRun(level,mixedTd(level));
    expect(pinRun.win).toBe(true);expect(mixedRun.win).toBe(true);
    expect(pinRun.spits).toHaveLength(2);expect(mixedRun.spits).toHaveLength(2);
    single.push(...pinRun.spits);mixed.push(...mixedRun.spits);
    encounters.push(mixedRun.encounter!);
  }
  expect(single.filter(n=>n>=1&&n<=3).length/single.length).toBeGreaterThan(0.5);
  expect(mixed.filter(n=>n===0).length/mixed.length).toBeGreaterThanOrEqual(0.65);
  expect(mixed.reduce((a,b)=>a+b,0)).toBeLessThan(single.reduce((a,b)=>a+b,0));
  const median=encounters.sort((a,b)=>a-b)[Math.floor(encounters.length/2)];
  expect(median).toBeGreaterThanOrEqual(20);expect(median).toBeLessThanOrEqual(30);
},120000);
