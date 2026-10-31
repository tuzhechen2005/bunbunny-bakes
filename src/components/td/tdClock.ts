import { MAX_LEVEL_TICKS } from '@/lib/td';
/** Monotonic active clock. Speed changes settle elapsed time at the old speed first. */
export function createTdClock(initialTick = 0) {
  let ticks = initialTick, started: number | null = null, speed = 1;
  const read = (now: number) => Math.min(MAX_LEVEL_TICKS, ticks + (started === null ? 0 : Math.max(0, now - started) * .06 * speed));
  const pause = (now: number) => { ticks = read(now); started = null; return Math.floor(ticks); };
  return { tick: (now: number) => Math.floor(read(now)), pause,
    resume(now: number) { if (started === null) started = now; },
    speed(value: 1 | 2, now: number) { const running = started !== null; pause(now); speed = value; if (running) started = now; },
  };
}
