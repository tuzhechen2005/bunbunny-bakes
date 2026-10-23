import { describe, expect, it } from "vitest";
import { FpsMonitor } from "@/lib/motion/fps";
import { createLoop } from "@/lib/motion/loop";

function feed(m: FpsMonitor, fromMs: number, toMs: number, frameMs: number) {
  for (let t = fromMs; t <= toMs; t += frameMs) m.frame(t);
}

describe("FpsMonitor", () => {
  it("stays healthy at 60 fps", () => {
    const m = new FpsMonitor();
    feed(m, 0, 10_000, 1000 / 60);
    expect(m.degraded).toBe(false);
  });

  it("degrades after sustained ~30 fps and notifies once", () => {
    const m = new FpsMonitor();
    let calls = 0;
    m.subscribe(() => calls++);
    feed(m, 0, 1000, 1000 / 30);
    expect(m.degraded).toBe(false); // not sustained long enough yet
    feed(m, 1000, 4000, 1000 / 30);
    expect(m.degraded).toBe(true);
    expect(calls).toBe(1);
  });

  it("ignores a short stutter", () => {
    const m = new FpsMonitor();
    feed(m, 0, 2000, 1000 / 60);
    feed(m, 2000, 2700, 1000 / 20); // 0.7 s slow
    feed(m, 2700, 6000, 1000 / 60);
    expect(m.degraded).toBe(false);
  });

  it("does not count idle gaps (loop asleep / tab hidden) as slow frames", () => {
    const m = new FpsMonitor();
    for (let i = 0; i < 20; i++) {
      m.frame(i * 5000); // one frame every 5 s
    }
    expect(m.degraded).toBe(false);
  });

  it("recovering fps resets the low streak", () => {
    const m = new FpsMonitor();
    feed(m, 0, 1200, 1000 / 30);
    feed(m, 1200, 2400, 1000 / 60);
    feed(m, 2400, 3600, 1000 / 30);
    expect(m.degraded).toBe(false);
  });

  it("reset clears the sticky flag", () => {
    const m = new FpsMonitor();
    feed(m, 0, 5000, 1000 / 25);
    expect(m.degraded).toBe(true);
    m.reset();
    expect(m.degraded).toBe(false);
  });
});

describe("createLoop", () => {
  function fakeRaf() {
    let next: ((t: number) => void) | null = null;
    let now = 0;
    return {
      raf: (cb: (t: number) => void) => {
        next = cb;
        return 1;
      },
      caf: () => {
        next = null;
      },
      pending: () => next !== null,
      frame(ms = 16) {
        now += ms;
        const cb = next;
        next = null;
        cb?.(now);
      },
    };
  }

  it("keeps ticking while step returns true and sleeps when it returns false", () => {
    const f = fakeRaf();
    let n = 0;
    const loop = createLoop(() => ++n < 3, { raf: f.raf, caf: f.caf, monitorFps: false });
    loop.start();
    expect(loop.running).toBe(true);
    f.frame();
    f.frame();
    expect(loop.running).toBe(true);
    f.frame(); // third call returns false
    expect(loop.running).toBe(false);
    expect(f.pending()).toBe(false);
    f.frame();
    expect(n).toBe(3); // nothing runs while asleep
  });

  it("start() is idempotent and wakes a sleeping loop; first dt is 0, later dts are clamped", () => {
    const f = fakeRaf();
    const dts: number[] = [];
    const loop = createLoop(
      (dt) => {
        dts.push(dt);
        return dts.length < 3;
      },
      { raf: f.raf, caf: f.caf, monitorFps: false },
    );
    loop.start();
    loop.start();
    f.frame(16);
    f.frame(16);
    f.frame(5000);
    expect(dts[0]).toBe(0);
    expect(dts[1]).toBeCloseTo(0.016);
    expect(dts[2]).toBe(0.1);
  });

  it("stop() cancels the pending frame", () => {
    const f = fakeRaf();
    let n = 0;
    const loop = createLoop(() => (n++, true), { raf: f.raf, caf: f.caf, monitorFps: false });
    loop.start();
    loop.stop();
    f.frame();
    expect(n).toBe(0);
    expect(loop.running).toBe(false);
  });
});
