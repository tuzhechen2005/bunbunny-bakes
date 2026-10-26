// Real touch events through CDP (Input.dispatchTouchEvent, Chromium only), with a virtual clock so
// velocity and "paused before release" do not depend on how fast the test runner is.
import type { CDPSession } from "@playwright/test";

export interface Finger {
  clock: number;
  wait(ms: number): Promise<void>;
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(): Promise<void>;
}

export function finger(cdp: CDPSession): Finger {
  let x = 0;
  let y = 0;
  const f: Finger = {
    clock: Date.now() / 1000,
    async wait(ms: number) {
      f.clock += ms / 1000;
      await new Promise((r) => setTimeout(r, Math.min(ms, 40)));
    },
    async down(px: number, py: number) {
      x = px;
      y = py;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }], timestamp: f.clock });
    },
    async move(px: number, py: number) {
      x = px;
      y = py;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 0 }], timestamp: f.clock });
    },
    async up() {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: f.clock });
    },
  };
  return f;
}

/** Drag from `from` to `to` in `steps` moves, `ms` in total; `release: false` keeps the finger down (caller calls `up`). */
export async function drag(
  f: Finger,
  from: [number, number],
  to: [number, number],
  { steps = 12, ms = 240, hold = 0, release = true }: { steps?: number; ms?: number; hold?: number; release?: boolean } = {},
) {
  await f.down(from[0], from[1]);
  for (let i = 1; i <= steps; i++) {
    await f.wait(ms / steps);
    await f.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  }
  if (hold) await f.wait(hold);
  if (release) await f.up();
}
