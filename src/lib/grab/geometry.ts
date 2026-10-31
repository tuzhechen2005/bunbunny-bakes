import { FIELD_HEIGHT, PIVOT_X, PIVOT_Y, SWING_PERIOD_TICKS } from "./types";

// Rounded sin(degrees) * 10000, baked at authoring time. No runtime trigonometry.
const SIN = [0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000] as const;
const SCALE = 10000;

export function swingAngle(tick: number): number {
  const phase = tick % SWING_PERIOD_TICKS;
  const half = Math.trunc(SWING_PERIOD_TICKS / 2);
  return phase <= half ? -70 + Math.trunc(140 * phase / half) : 70 - Math.trunc(140 * (phase - half) / half);
}

function direction(angle: number): { x: number; y: number } {
  const magnitude = Math.abs(angle);
  return { x: SIN[magnitude] * Math.sign(angle), y: SIN[90 - magnitude] };
}

export function clawTip(angle: number, length: number): { x: number; y: number } {
  const d = direction(angle);
  return { x: PIVOT_X + Math.trunc(d.x * length / SCALE), y: PIVOT_Y + Math.trunc(d.y * length / SCALE) };
}

export function fieldLength(angle: number): number {
  const d = direction(angle);
  const bottom = Math.trunc(FIELD_HEIGHT * SCALE / d.y);
  return d.x === 0 ? bottom : Math.min(bottom, Math.trunc(PIVOT_X * SCALE / Math.abs(d.x)));
}

/** Exact integer circle/segment test, including tangency and degenerate segments. */
export function circleIntersectsSegment(
  x: number, y: number, radius: number, ax: number, ay: number, bx: number, by: number,
): boolean {
  const dx = bx - ax, dy = by - ay, px = x - ax, py = y - ay;
  const squareLength = dx * dx + dy * dy;
  const projection = px * dx + py * dy;
  if (projection <= 0) return px * px + py * py <= radius * radius;
  if (projection >= squareLength) return (x - bx) ** 2 + (y - by) ** 2 <= radius * radius;
  const cross = px * dy - py * dx;
  return cross * cross <= radius * radius * squareLength;
}

/** First swept-tip contact, at one field-unit resolution; stable item order breaks ties. */
export function firstContact(
  angle: number, from: number, to: number, items: readonly { x: number; y: number; radius: number }[],
): { index: number; length: number } | null {
  let a = clawTip(angle, from);
  const b = clawTip(angle, to);
  const candidates = items.map((item, index) => ({ item, index })).filter(({ item }) =>
    // Allow for the one-unit rounded path's deviation from this coarse chord.
    circleIntersectsSegment(item.x, item.y, item.radius + 2, a.x, a.y, b.x, b.y));
  if (!candidates.length) return null;
  for (let length = from + 1; length <= to; length++) {
    const tip = clawTip(angle, length);
    for (const { item, index } of candidates) {
      if (circleIntersectsSegment(item.x, item.y, item.radius, a.x, a.y, tip.x, tip.y)) return { index, length };
    }
    a = tip;
  }
  return null;
}
