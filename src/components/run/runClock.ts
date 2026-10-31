import { MAX_RUN_TICKS, TICK_RATE } from "@/lib/run";

export const elapsedTick = (elapsedMs: number): number => Math.min(MAX_RUN_TICKS, Math.round(elapsedMs * TICK_RATE / 1000));

/** Inject a monotonic time source. Paused/hidden time never enters the run log. */
export function createRunClock(initialMs = 0) {
  let elapsed = initialMs;
  let started: number | null = null;
  const read = (now: number) => elapsed + (started === null ? 0 : Math.max(0, now - started));
  return {
    read,
    resume(now: number) { if (started === null) started = now; },
    pause(now: number) { elapsed = read(now); started = null; return elapsed; },
  };
}
