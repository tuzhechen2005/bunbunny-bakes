/**
 * Pure layout maths of the rope rack (FRONTEND.md 4.1, prototype `layout` / `frame`). No DOM, no React:
 * unit tested in tests/unit/rackGeometry.test.ts.
 */

/** Card width is 54% of the rack, at most this many px. */
export const CARD_MAX_PX = 232;
/** Gap between neighbouring photos. */
export const CARD_GAP_PX = 24;
/** Side photos shrink by this fraction. */
export const SIDE_SHRINK = 0.14;
/** Rope height at its ends / resting sag in the middle. */
export const ROPE_Y0 = 20;
export const ROPE_SAG = 12;
/** The rope runs this far beyond both screen edges. */
export const ROPE_OVERSHOOT = 30;
/** Cards further than this many slots from the centre are hidden. */
export const VISIBLE_SLOTS = 2.4;

/** Slight individual tilt of the pegs at rest (degrees), cycled by index. */
export const REST_DEG = [0.7, -1, 0.5, -0.6] as const;

export interface RackMetrics {
  /** Rack width in px. */
  width: number;
  /** Photo (card) width. */
  cardW: number;
  /** Distance between neighbouring photo centres. */
  spacing: number;
  /** Rope height at the ends. */
  y0: number;
  /** Resting sag. */
  sag: number;
  /** Total rack height (rope + sag + photo + room for the shadow). */
  height: number;
}

export function rackMetrics(width: number): RackMetrics {
  const w = width > 0 ? width : 375;
  const cardW = Math.round(Math.min(w * 0.54, CARD_MAX_PX));
  return {
    width: w,
    cardW,
    spacing: cardW + CARD_GAP_PX,
    y0: ROPE_Y0,
    sag: ROPE_SAG,
    height: ROPE_Y0 + ROPE_SAG + cardW + 38,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Half the rope span, used to normalise x for the parabola. */
export function ropeHalf(width: number): number {
  return width / 2 + ROPE_OVERSHOOT;
}

/** Rope height at horizontal offset `x` from the rack centre, for the given sag. */
export function ropeY(x: number, m: Pick<RackMetrics, "width" | "y0">, sag: number): number {
  const u = clamp(x / ropeHalf(m.width), -1.2, 1.2);
  return m.y0 + sag * (1 - u * u);
}

/** Quadratic path of the rope (all rope strokes share it). Its mid point sits exactly `sag` below the ends. */
export function ropePath(m: Pick<RackMetrics, "width" | "y0">, sag: number): string {
  const { width: w, y0 } = m;
  return `M ${-ROPE_OVERSHOOT} ${y0} Q ${w / 2} ${(y0 + 2 * sag).toFixed(2)} ${w + ROPE_OVERSHOOT} ${y0}`;
}

export interface Strands {
  /** Dark diagonal strand segments. */
  dark: string;
  /** Light diagonal strand segments (offset a little, thinner). */
  light: string;
}

/** Strand step along x (px). */
export const STRAND_STEP = 3.4;

/**
 * Short diagonal segments along the rope curve: a twisted jute look. Each segment crosses the
 * rope slanted by the local slope so it follows the sag.
 */
export function ropeStrands(m: Pick<RackMetrics, "width" | "y0">, sag: number): Strands {
  const { width: w } = m;
  const half = ropeHalf(w);
  let dark = "";
  let light = "";
  const ox = 1.25;
  const oy = 1.55;
  for (let tx = -ROPE_OVERSHOOT; tx <= w + ROPE_OVERSHOOT; tx += STRAND_STEP) {
    const rel = tx - w / 2;
    const yy = ropeY(rel, m, sag);
    const slope = (-2 * sag * rel) / (half * half);
    dark += `M${(tx - ox).toFixed(1)} ${(yy - oy - slope * ox).toFixed(2)}L${(tx + ox).toFixed(1)} ${(yy + oy + slope * ox).toFixed(2)}`;
    light += `M${(tx - ox + 1.5).toFixed(1)} ${(yy - oy * 0.7 - slope * ox).toFixed(2)}L${(tx + ox * 0.4 + 1.5).toFixed(1)} ${(yy + slope * ox).toFixed(2)}`;
  }
  return { dark, light };
}

export interface CardPose {
  /** Horizontal centre of the card, from the rack's left edge. */
  cx: number;
  /** Top of the card (peg line) before any entrance drop. */
  top: number;
  scale: number;
  opacity: 0 | 1;
  zIndex: number;
}

/** Where card `i` sits when the rope shows position `pos` (fractional index). */
export function cardPose(i: number, pos: number, m: RackMetrics, sag: number): CardPose {
  const dd = i - pos;
  const a = Math.abs(dd);
  const t0 = Math.min(a, 1);
  const t = t0 * t0 * (3 - 2 * t0);
  const x = dd * m.spacing;
  return {
    cx: m.width / 2 + x,
    top: ropeY(x, m, sag) - 2,
    scale: 1 - SIDE_SHRINK * t,
    opacity: a > VISIBLE_SLOTS ? 0 : 1,
    zIndex: 10 - Math.round(a),
  };
}

/** Which slot the rope position is closest to. */
export function nearestIndex(pos: number, count: number): number {
  return clamp(Math.round(pos), 0, Math.max(0, count - 1));
}

/** Rest tilt of peg `i` in radians. */
export function restAngle(i: number): number {
  return (REST_DEG[((i % REST_DEG.length) + REST_DEG.length) % REST_DEG.length] * Math.PI) / 180;
}

/** Drop-in delay (ms) of card `i` when the page opens. */
export function dropDelayMs(i: number): number {
  return 120 + i * 110;
}

/** Start offset (px above the rope) of card `i`'s entrance drop. */
export function dropStartPx(i: number): number {
  return -420 - i * 40;
}
