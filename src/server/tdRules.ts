import { MAX_INPUTS } from '@/lib/td';

export function tdTierCount(snapshot: unknown): number {
  if (!Array.isArray(snapshot) || snapshot.length < 1 || snapshot.length > 100
    || !snapshot.every(t => t && typeof t.id === 'string' && t.id)) throw new Error('bad TD tiers');
  return snapshot.length;
}
/** Same-tick purchases are legitimate. Review sustained sub-120ms input cadence. */
export function isTdSuspicious(inputs: readonly { tick: number }[]): boolean {
  if (inputs.length >= MAX_INPUTS) return true;
  if (inputs.length < 10) return false;
  const gaps = inputs.slice(1).map((v, i) => v.tick - inputs[i].tick).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] < 7.2;
}
