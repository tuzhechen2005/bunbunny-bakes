// Baked variants of a bread picture: the bread itself turns pale (raw), golden (perfect) or to
// charcoal with ember cracks (burnt). Each source is processed once on a 256px canvas and served
// as object URLs, so the board only swaps an <img> src: no per-frame CSS filters.

export type BakeStage = "raw" | "perfect" | "burnt";
export type BakedSet = Record<BakeStage, string>;
/** Golden bread (D183): gilded raw and perfect pictures; burnt golden bread uses the charcoal one. */
export type GoldenSet = Record<"raw" | "perfect", string>;

const SIZE = 256;
const cache = new Map<string, Promise<BakedSet | null>>();
const goldCache = new Map<string, Promise<GoldenSet | null>>();

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function seeded(src: string) {
  let s = 1;
  for (let i = 0; i < src.length; i++) s = (s * 31 + src.charCodeAt(i)) % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob"))), "image/webp", .9));
}

/** Pixel pass: `fn` maps (r, g, b, distance from centre 0..1, x, y) to a new colour. */
function pass(base: ImageData, fn: (r: number, g: number, b: number, d: number, x: number, y: number) => [number, number, number]): ImageData {
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const p = out.data, h = SIZE / 2;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4, d = Math.hypot(x - h, y - h) / h;
    const [r, g, b] = fn(p[i], p[i + 1], p[i + 2], d, x / SIZE, y / SIZE);
    p[i] = clamp(r); p[i + 1] = clamp(g); p[i + 2] = clamp(b);
  }
  return out;
}

async function source(src: string) {
  const img = await load(src);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE;
  const x = canvas.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  // Cover-fit like object-fit: cover.
  const k = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  x.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return { canvas, x, base: x.getImageData(0, 0, SIZE, SIZE) };
}

async function bake(src: string): Promise<BakedSet | null> {
  const s = await source(src);
  if (!s) return null;
  const { canvas, x, base } = s;

  // Raw dough: washed towards cream, softer contrast.
  x.putImageData(pass(base, (r, g, b) => [r * .6 + 243 * .4, g * .6 + 230 * .4, b * .62 + 207 * .38]), 0, 0);
  const raw = await toUrl(canvas);

  // Golden: warm toast curve, deeper caramel crust towards the rim, a soft buttery shine.
  x.putImageData(pass(base, (r, g, b, d, u, v) => {
    let R = (r * 1.04 + 8 - 128) * 1.08 + 128, G = (g * .97 + 3 - 128) * 1.08 + 128, B = (b * .8 - 128) * 1.08 + 128;
    const crust = 1 - .3 * smooth(.5, 1.05, d);
    R *= crust; G *= crust * .92; B *= crust * .8;
    const shine = .38 * Math.exp(-((u - .34) ** 2 + (v - .3) ** 2) / .03);
    return [R + (255 - R) * shine, G + (250 - G) * shine, B + (225 - B) * shine];
  }), 0, 0);
  const perfect = await toUrl(canvas);

  // Charcoal: the shape survives as dark brown-black texture, then glowing cracks and ash.
  x.putImageData(pass(base, (r, g, b, d) => {
    const l = (r * .3 + g * .59 + b * .11) / 255, v = 16 + 58 * l ** 1.3 + 10 * smooth(.6, 1, d);
    return [v * 1.06, v * .86, v * .72];
  }), 0, 0);
  const rand = seeded(src);
  x.save();
  x.globalCompositeOperation = "lighter"; x.lineCap = "round"; x.lineJoin = "round";
  x.shadowColor = "rgba(255,110,30,.9)"; x.shadowBlur = 8;
  for (let c = 0; c < 6; c++) {
    let px = SIZE * (.2 + rand() * .6), py = SIZE * (.2 + rand() * .6), a = rand() * Math.PI * 2;
    x.strokeStyle = `rgba(255,${120 + Math.floor(rand() * 60)},40,${.55 + rand() * .35})`; x.lineWidth = 1.2 + rand() * 1.6;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 6; s++) { a += (rand() - .5) * 1.4; px += Math.cos(a) * 14; py += Math.sin(a) * 14; x.lineTo(px, py); }
    x.stroke();
  }
  x.restore();
  for (let s = 0; s < 70; s++) {
    x.fillStyle = `rgba(200,192,184,${.12 + rand() * .25})`;
    x.beginPath(); x.arc(rand() * SIZE, rand() * SIZE, .8 + rand() * 2.2, 0, Math.PI * 2); x.fill();
  }
  const burnt = await toUrl(canvas);
  return { raw, perfect, burnt };
}

/** Baked variants for one picture; null while loading or if the picture cannot be read. */
export function bakedVariants(src: string): Promise<BakedSet | null> {
  let p = cache.get(src);
  if (!p) { p = bake(src).catch(() => null); cache.set(src, p); }
  return p;
}

/** Four-point star glint, drawn additively. */
function glint(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.save(); x.globalCompositeOperation = "lighter";
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, "rgba(255,252,230,.95)"); g.addColorStop(.3, "rgba(255,226,130,.5)"); g.addColorStop(1, "rgba(255,200,60,0)");
  x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgba(255,250,225,.9)";
  x.beginPath(); x.moveTo(cx, cy - r * 1.5); x.lineTo(cx + r * .14, cy - r * .14); x.lineTo(cx + r * 1.5, cy); x.lineTo(cx + r * .14, cy + r * .14);
  x.lineTo(cx, cy + r * 1.5); x.lineTo(cx - r * .14, cy + r * .14); x.lineTo(cx - r * 1.5, cy); x.lineTo(cx - r * .14, cy - r * .14); x.closePath(); x.fill();
  x.restore();
}

async function gild(src: string): Promise<GoldenSet | null> {
  const s = await source(src);
  if (!s) return null;
  const { canvas, x, base } = s;
  const out = {} as GoldenSet;
  // Gold leaf: the picture's own light and dark become a bronze-to-champagne ramp, with a little of
  // the original colour kept so each bread stays recognisable. Raw is matte; perfect is lacquered.
  for (const stage of ["raw", "perfect"] as const) {
    const shine = stage === "perfect" ? 1 : .55;
    x.putImageData(pass(base, (r, g, b, d, u, v) => {
      const l = (r * .3 + g * .59 + b * .11) / 255, t = Math.min(1, Math.max(0, (l - .12) * 1.25));
      // dark #7a5312 -> mid #dfa626 -> light #fff0a8
      let R = t < .55 ? 122 + (223 - 122) * (t / .55) : 223 + (255 - 223) * ((t - .55) / .45);
      let G = t < .55 ? 83 + (166 - 83) * (t / .55) : 166 + (240 - 166) * ((t - .55) / .45);
      let B = t < .55 ? 18 + (38 - 18) * (t / .55) : 38 + (168 - 38) * ((t - .55) / .45);
      R = R * .82 + r * .18; G = G * .82 + g * .18; B = B * .82 + b * .18;
      const diag = Math.exp(-(((u + v) - 0.95) ** 2) / .012);        // one bright diagonal band
      const spot = Math.exp(-((u - .3) ** 2 + (v - .28) ** 2) / .02);  // soft hot spot
      const gleam = shine * (.42 * diag + .36 * spot);
      const rim = .22 * smooth(.62, 1.05, d);                          // darker burnished edge
      return [(R + (255 - R) * gleam) * (1 - rim), (G + (248 - G) * gleam) * (1 - rim * 1.1), (B + (205 - B) * gleam) * (1 - rim * 1.5)];
    }), 0, 0);
    x.strokeStyle = "rgba(255,226,120,.9)"; x.lineWidth = 7; x.strokeRect(3.5, 3.5, SIZE - 7, SIZE - 7);
    if (stage === "perfect") { glint(x, SIZE * .3, SIZE * .28, 13); glint(x, SIZE * .74, SIZE * .66, 9); }
    else glint(x, SIZE * .3, SIZE * .28, 8);
    out[stage] = await toUrl(canvas);
  }
  return out;
}

/** Golden variants for one picture; null while loading or if the picture cannot be read. */
export function goldenVariants(src: string): Promise<GoldenSet | null> {
  let p = goldCache.get(src);
  if (!p) { p = gild(src).catch(() => null); goldCache.set(src, p); }
  return p;
}
