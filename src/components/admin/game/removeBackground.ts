// Pure pixel logic for game tier images (L3): decide whether an image already has a real
// transparent background, a fake (painted) checkerboard, or an opaque background, and remove a
// near-white background by flood fill from the edges with a feathered edge. RGBA, row-major.

export type ImageKind = "alpha" | "fake-checker" | "opaque";

const lum = (d: Uint8ClampedArray, i: number) => Math.min(d[i], d[i + 1], d[i + 2]);
const spread = (d: Uint8ClampedArray, i: number) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);

/** Pixel numbers of the 1-px border: top row, bottom row, and the two side columns. */
function ringIndexes(w: number, h: number): { top: number[]; bottom: number[]; sides: number[] } {
  const top: number[] = [];
  const bottom: number[] = [];
  const sides: number[] = [];
  for (let x = 0; x < w; x++) {
    top.push(x);
    bottom.push((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) sides.push(y * w, y * w + w - 1);
  return { top, bottom, sides };
}

/** Looks at the border of the image only. */
export function classifyImage(data: Uint8ClampedArray, w: number, h: number): ImageKind {
  if (w < 4 || h < 4) return "opaque";
  const { top, bottom, sides } = ringIndexes(w, h);
  const ring = [...top, ...bottom, ...sides];

  // Real transparency: the edge is mostly (nearly) transparent.
  let clear = 0;
  for (const p of ring) if (data[p * 4 + 3] < 16) clear++;
  if (clear / ring.length >= 0.6) return "alpha";

  // Painted checkerboard: opaque light pixels of two tones (white and light grey) that alternate.
  let white = 0;
  let grey = 0;
  for (const p of ring) {
    const i = p * 4;
    if (data[i + 3] < 250) continue;
    if (spread(data, i) > 14) continue;
    const m = lum(data, i);
    if (m >= 246) white++;
    else if (m >= 150) grey++;
  }
  if (white + grey >= ring.length * 0.8 && Math.min(white, grey) >= ring.length * 0.15) {
    const tone = (p: number) => (lum(data, p * 4) >= 246 ? 1 : 0);
    let flips = 0;
    for (const row of [top, bottom]) for (let k = 1; k < row.length; k++) if (tone(row[k]) !== tone(row[k - 1])) flips++;
    if (flips >= 6) return "fake-checker";
  }
  return "opaque";
}

export interface RemoveOptions {
  /** How far from pure white still counts as background (0-255). */
  tolerance?: number;
}

/** Returns a copy with the near-white background (connected to the border) made transparent. */
export function removeWhiteBackground(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  options: RemoveOptions = {},
): { data: Uint8ClampedArray; removedFraction: number } {
  const tol = options.tolerance ?? 28;
  const n = w * h;
  const isBg = (p: number) => {
    const i = p * 4;
    return src[i + 3] > 0 && lum(src, i) >= 255 - tol && spread(src, i) <= tol;
  };
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (p: number) => {
    if (!bg[p] && isBg(p)) {
      bg[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }

  // Alpha: foreground 255, background 0, then erode one pixel (drops the white halo) and blur 3x3.
  const eroded = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let a = bg[p] ? 0 : 255;
      if (a) {
        if (x > 0 && bg[p - 1]) a = 0;
        else if (x < w - 1 && bg[p + 1]) a = 0;
        else if (y > 0 && bg[p - w]) a = 0;
        else if (y < h - 1 && bg[p + w]) a = 0;
      }
      eroded[p] = a;
    }
  }
  const out = new Uint8ClampedArray(src);
  let removed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += eroded[yy * w + xx];
          count++;
        }
      }
      const alpha = Math.round(sum / count);
      const i = (y * w + x) * 4;
      out[i + 3] = Math.round((src[i + 3] * alpha) / 255);
      if (out[i + 3] < 8) removed++;
    }
  }
  return { data: out, removedFraction: removed / n };
}
