import { describe, expect, it } from "vitest";
import { Pendulum, PEG_PENDULUM, pivotAccel } from "@/lib/motion/pendulum";
import { ROPE_SPRING, Spring, SUBSTEP } from "@/lib/motion/spring";

const DEG = 180 / Math.PI;

function run(step: (dt: number) => void, seconds: number, hz: number) {
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) step(1 / hz);
}

describe("Spring", () => {
  it("settles on the target without overshooting much", () => {
    const s = new Spring(0);
    s.target = 1;
    let peak = 0;
    run((dt) => (peak = Math.max(peak, s.step(dt))), 3, 60);
    expect(s.x).toBeCloseTo(1, 3);
    expect(s.isAtRest()).toBe(true);
    expect(peak).toBeLessThan(1.01); // damping ratio 0.9: <0.2% overshoot
  });

  it("is deterministic across frame rates (60 vs 120 vs 144 Hz)", () => {
    const at = (hz: number) => {
      const s = new Spring(0);
      s.target = 100;
      run((dt) => s.step(dt), 0.5, hz);
      return s.x;
    };
    expect(at(120)).toBeCloseTo(at(60), 6);
    // 144 Hz does not divide 240: carried-over remainders keep it within a substep's worth.
    expect(Math.abs(at(144) - at(60))).toBeLessThan(0.5);
  });

  it("carries leftover time instead of dropping it", () => {
    const a = new Spring(0);
    const b = new Spring(0);
    a.target = b.target = 10;
    a.step(SUBSTEP * 0.5);
    expect(a.x).toBe(0); // not enough time for a substep yet
    a.step(SUBSTEP * 0.5);
    b.step(SUBSTEP);
    expect(a.x).toBeCloseTo(b.x, 12);
  });

  it("keeps the velocity it was given (flick)", () => {
    const s = new Spring(0);
    s.set(0, 10);
    s.step(0.05);
    expect(s.x).toBeGreaterThan(0);
  });
});

describe("Pendulum", () => {
  /** A hard flick: pivot accelerates at the cap, then brakes, 0.1 s each. */
  function flick(hz: number) {
    const p = new Pendulum();
    let peak = 0;
    let i = 0;
    let lastBig = 0;
    run(
      (dt) => {
        const t = i / hz;
        const drive = t < 0.1 ? 50 : t < 0.2 ? -50 : 0; // asks for 10x the cap
        p.step(dt, drive);
        i++;
        peak = Math.max(peak, Math.abs(p.angle));
        if (Math.abs(p.angle) > 1e-3) lastBig = i / hz;
      },
      3,
      hz,
    );
    return { peak: peak * DEG, settledAt: lastBig };
  }

  it("keeps a capped hard flick within 15 degrees and settles in about a second", () => {
    const { peak, settledAt } = flick(60);
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThanOrEqual(15);
    // Back inside 0.06 degrees within ~1.2 s of the flick ending (flick lasts 0.2 s).
    expect(settledAt).toBeLessThan(0.2 + 1.2);
  });

  it("even a sustained capped push stays within 30 degrees (static deflection of the cap)", () => {
    const p = new Pendulum();
    let peak = 0;
    run((dt) => (peak = Math.max(peak, Math.abs(p.step(dt, 100)))), 3, 60);
    expect(peak * DEG).toBeLessThan(30);
  });

  it("is deterministic at 60 vs 120 Hz", () => {
    expect(flick(120).peak).toBeCloseTo(flick(60).peak, 1);
  });

  it("swings opposite to the pivot acceleration and comes to rest", () => {
    const p = new Pendulum();
    run((dt) => p.step(dt, 3), 0.1, 60);
    expect(p.angle).toBeLessThan(0);
    run((dt) => p.step(dt, 0), 4, 60);
    expect(p.isAtRest()).toBe(true);
  });

  it("pivotAccel converts px/s velocity change to m/s^2", () => {
    expect(pivotAccel(0, 3000, 1, 1000)).toBeCloseTo(3);
    expect(pivotAccel(0, 3000, 0, 1000)).toBe(0);
  });
});

describe("FRONTEND.md section 5 constants are pinned", () => {
  it("spring", () => {
    expect(ROPE_SPRING).toEqual({ frequencyHz: 1.7, dampingRatio: 0.9 });
    expect(SUBSTEP).toBe(1 / 240);
  });

  it("pendulum", () => {
    expect(PEG_PENDULUM).toEqual({ length: 0.42, dampingRatio: 0.85, maxDrive: 5 });
  });

  it("spring step response is that of 1.7 Hz (0.5 s in: 0.991; 1.5 Hz or 1.9 Hz differ)", () => {
    const s = new Spring(0);
    s.target = 1;
    run((dt) => s.step(dt), 0.5, 60);
    expect(s.x).toBeGreaterThan(0.989);
    expect(s.x).toBeLessThan(0.993);
  });

  /** One-sided pivot push of `drive` m/s^2 for `seconds`, then free swing; returns peak degrees. */
  function push(drive: number, seconds: number) {
    const p = new Pendulum();
    let peak = 0;
    for (let i = 0; i < 480; i++) {
      p.step(1 / 120, i / 120 < seconds ? drive : 0);
      peak = Math.max(peak, Math.abs(p.angle));
    }
    return peak * DEG;
  }

  it("capped push peaks: ~5.7 deg for 0.1 s, ~11.1 deg for 0.2 s (matches L = 0.42 m)", () => {
    expect(push(5, 0.1)).toBeGreaterThan(5.4);
    expect(push(5, 0.1)).toBeLessThan(6.0);
    expect(push(5, 0.2)).toBeGreaterThan(10.8);
    expect(push(5, 0.2)).toBeLessThan(11.4);
  });

  it("a request above the cap is clamped to the cap", () => {
    expect(push(500, 0.2)).toBeCloseTo(push(5, 0.2), 6);
  });
});
