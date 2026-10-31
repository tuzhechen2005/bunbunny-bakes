import { TICK_RATE, type RunInput } from "@/lib/run";
export const RUN_SUSPICIOUS_MEDIAN_GAP_MS = 120;
export const inputTime = (tick: number): number => Math.round(tick * 1000 / TICK_RATE);
/** Review flags never remove an otherwise verified run from ranking. */
export function isRunSuspicious(inputs: readonly RunInput[], endTick: number): boolean {
  if (endTick > 10 * 60 * TICK_RATE) return true;
  if (inputs.length < 2) return false;
  const gaps = inputs.slice(1).map((input, i) => input.tick - inputs[i].tick).sort((a,b) => a-b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid-1] + gaps[mid]) / 2;
  return median * 1000 < RUN_SUSPICIOUS_MEDIAN_GAP_MS * TICK_RATE;
}
