import { MAX_RUN_TICKS, TICKS_PER_SECOND } from "@/lib/grab";

export const elapsedTick = (elapsedMs: number): number => Math.min(MAX_RUN_TICKS, Math.round(elapsedMs * TICKS_PER_SECOND / 1000));

/** Inject a monotonic time source. Paused/hidden time never enters the run log. */
export function createGrabClock(initialMs = 0) {
  let elapsed = initialMs;
  let started: number | null = null;
  const read = (now: number) => elapsed + (started === null ? 0 : Math.max(0, now - started));
  return {
    read,
    resume(now: number) { if (started === null) started = now; },
    pause(now: number) { elapsed = read(now); started = null; return elapsed; },
  };
}
