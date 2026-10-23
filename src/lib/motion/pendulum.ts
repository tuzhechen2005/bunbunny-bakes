/**
 * Damped pendulum hanging from a moving pivot (a clothes peg on the rope).
 * The pivot's horizontal acceleration drives it; the drive is capped so a hard flick still
 * tilts the photo only ~10-15 degrees. Angle is in radians, 0 = hanging straight down,
 * positive = tilted toward +x. Same 1/240 s fixed substep as the spring.
 */
import { SUBSTEP } from "./spring";

export interface PendulumConfig {
  /** Equivalent pendulum length in metres. */
  length: number;
  /** Fraction of critical damping. */
  dampingRatio: number;
  /** Max |pivot acceleration| in m/s^2 fed to the pendulum. */
  maxDrive: number;
}

/** Photo-on-a-peg parameters from FRONTEND.md section 5. */
export const PEG_PENDULUM: PendulumConfig = { length: 0.42, dampingRatio: 0.85, maxDrive: 5 };

const G = 9.81;
const EPS_ANGLE = 5e-4; // ~0.03 degrees
const EPS_OMEGA = 5e-3;

export class Pendulum {
  angle = 0;
  omega = 0;
  private acc = 0;

  constructor(readonly config: PendulumConfig = PEG_PENDULUM) {}

  /**
   * Advance by `dt` seconds with the pivot accelerating at `pivotAccel` m/s^2 (+x).
   * Accelerating the pivot toward +x swings the bob toward -x (inertia).
   */
  step(dt: number, pivotAccel = 0): number {
    const { length: L, dampingRatio, maxDrive } = this.config;
    const drive = Math.max(-maxDrive, Math.min(maxDrive, pivotAccel));
    const w0 = Math.sqrt(G / L);
    this.acc += Math.max(0, dt);
    while (this.acc >= SUBSTEP - 1e-9) {
      const alpha =
        -(G / L) * Math.sin(this.angle) -
        2 * dampingRatio * w0 * this.omega -
        (drive / L) * Math.cos(this.angle);
      this.omega += alpha * SUBSTEP;
      this.angle += this.omega * SUBSTEP;
      this.acc -= SUBSTEP;
    }
    if (this.acc < 0) this.acc = 0;
    return this.angle;
  }

  isAtRest(): boolean {
    return Math.abs(this.angle) < EPS_ANGLE && Math.abs(this.omega) < EPS_OMEGA;
  }

  settle(): void {
    this.angle = 0;
    this.omega = 0;
  }
}

/**
 * Convert a pivot velocity change into acceleration in m/s^2.
 * `pxPerMetre` maps screen pixels to the pendulum's metres.
 */
export function pivotAccel(prevVelocityPx: number, velocityPx: number, dt: number, pxPerMetre: number): number {
  if (dt <= 0) return 0;
  return (velocityPx - prevVelocityPx) / dt / pxPerMetre;
}
