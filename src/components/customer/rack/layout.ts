/**
 * Pure layout maths for the rope rack (FRONTEND.md 4.1 item 3). `d` is the signed distance of a
 * card from the centre in item units (position - index), so it is fractional while the rope moves.
 * Near spacing is wide (the neighbours peek out beside the centre card), far spacing is tight
 * (the rest pack closer), like Hanger Club's rackSlot.
 */

export interface Slot {
  /** Horizontal offset of the card centre from the stage centre, px. */
  x: number;
  scale: number;
  /** Degrees; the side cards turn their face toward the centre card. */
  rotateY: number;
  opacity: number;
  z: number;
  /** false once the card is far enough off stage that it is not worth painting. */
  visible: boolean;
}

export const NEAR_SPACING = 0.78; // card sizes between the centre card and its neighbour
export const FAR_SPACING = 0.3; // card sizes between cards further out
export const NEAR_TILT = 40;
export const FAR_TILT = 12;
export const MAX_VISIBLE_DISTANCE = 3.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Photo-card width for a stage of the given width (the centre card, the largest one). */
export function cardSize(stageWidth: number): number {
  return Math.round(clamp(stageWidth * 0.6, 140, 280));
}

/** Distance in px the rope moves per item near the centre (used to turn drag px into items). */
export function pitch(size: number): number {
  return size * NEAR_SPACING;
}

export function slot(d: number, size: number): Slot {
  const a = Math.abs(d);
  const sign = d < 0 ? -1 : 1;
  const near = Math.min(a, 1);
  const far = Math.min(Math.max(a - 1, 0), 3);
  return {
    x: sign * (near * size * NEAR_SPACING + far * size * FAR_SPACING),
    scale: 1 - 0.28 * near - 0.1 * Math.min(far, 1),
    rotateY: -sign * (near * NEAR_TILT + Math.min(far, 1) * FAR_TILT),
    opacity: clamp(1 - 0.1 * near - 0.18 * Math.min(far, 3), 0.3, 1),
    z: Math.round(100 - a * 20),
    visible: a <= MAX_VISIBLE_DISTANCE,
  };
}

/** How far the rope dips below its ends at horizontal offset x (px) on a stage of width w. */
export function ropeSag(x: number, stageWidth: number, maxSag: number): number {
  const t = x / (stageWidth / 2);
  return Math.max(0, maxSag * (1 - t * t));
}
