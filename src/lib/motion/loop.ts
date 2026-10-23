/**
 * requestAnimationFrame loop that sleeps when everything is at rest.
 * `step` returns true while anything is still moving; when it returns false the loop stops
 * and costs nothing until `start()` is called again (e.g. on the next pointer move).
 */
import { motionHealth } from "./fps";

export type StepFn = (dtSeconds: number, nowMs: number) => boolean;

export interface LoopOptions {
  /** Largest dt passed to `step` (a long gap must not explode the physics). Default 0.1 s. */
  maxDt?: number;
  /** Feed frames to the shared fps monitor. Default true. */
  monitorFps?: boolean;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createLoop(step: StepFn, opts: LoopOptions = {}): Loop {
  const maxDt = opts.maxDt ?? 0.1;
  const monitor = opts.monitorFps ?? true;
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  let id: number | null = null;
  let prev: number | null = null;

  const tick = (now: number) => {
    id = null;
    const dt = prev === null ? 0 : Math.min((now - prev) / 1000, maxDt);
    prev = now;
    if (monitor) motionHealth.frame(now);
    const more = step(dt, now);
    if (more) id = raf(tick);
    else prev = null;
  };

  return {
    start() {
      if (id !== null) return;
      prev = null;
      if (monitor) motionHealth.restart();
      id = raf(tick);
    },
    stop() {
      if (id !== null) caf(id);
      id = null;
      prev = null;
    },
    get running() {
      return id !== null;
    },
  };
}
