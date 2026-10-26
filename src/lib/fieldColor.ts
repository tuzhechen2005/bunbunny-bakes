/**
 * Per-product home colours (D95). Pure: shared by the server (menu payload) and the admin picker.
 * `fieldFor(bg)` derives the text colours from the background by WCAG contrast; the four original
 * colours keep their hand-tuned pairs exactly (src/lib/field.ts FIELDS, D88).
 */

export interface FieldColors {
  bg: string;
  ink: string;
  ink2: string;
}

export interface FieldPreset {
  name: string;
  hex: string;
}

export const DEFAULT_FIELD_COLOR = "#EFE7DA";
export const MIN_CONTRAST = 4.5;

export const FIELD_PRESETS: readonly FieldPreset[] = [
  { name: "浅豆沙", hex: "#DCC5BB" },
  { name: "乳酪黄", hex: "#F0BF45" },
  { name: "奶蓝", hex: "#CFDDEA" },
  { name: "焦糖", hex: "#B05219" },
  { name: "巧克力", hex: "#5A3A2A" },
  { name: "抹茶", hex: "#B9C9A0" },
  { name: "草莓粉", hex: "#F2C4C9" },
  { name: "芋泥紫", hex: "#CFC0DD" },
  { name: "奶白", hex: "#EFE7DA" },
  { name: "炭灰", hex: "#3A3633" },
];

/** Hand-tuned pairs of the original four colours; they must never change. */
const FIXED: Record<string, { ink: string; ink2: string }> = {
  "#DCC5BB": { ink: "#4A2723", ink2: "#674741" },
  "#F0BF45": { ink: "#36260A", ink2: "#5F4817" },
  "#CFDDEA": { ink: "#1B2C44", ink2: "#4A5A6F" },
  "#B05219": { ink: "#FFF8EE", ink2: "#FFF0DF" },
};

const LIGHT_INK = "#FFF8EE";
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(from: string, to: string, t: number): string {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb);
}

/** The background's own hue, darkened until it reads at 7:1; black if even that is not enough. */
function darkTint(bg: string): string {
  for (let k = 0; k <= 20; k++) {
    const ink = mix(bg, "#000000", 0.5 + k * 0.025);
    if (contrastRatio(ink, bg) >= 7) return ink;
  }
  return "#000000";
}

/** The cream light ink, or pure white when only white reaches 4.5:1. */
function lightInk(bg: string): string {
  return contrastRatio(LIGHT_INK, bg) < MIN_CONTRAST && contrastRatio("#FFFFFF", bg) >= MIN_CONTRAST
    ? "#FFFFFF"
    : LIGHT_INK;
}

/** A softer tone of `ink` (towards the background) that still reaches 4.5:1; `ink` itself if none does. */
function softer(ink: string, bg: string): string {
  for (let t = 0.3; t > 0; t -= 0.02) {
    const c = mix(ink, bg, t);
    if (contrastRatio(c, bg) >= MIN_CONTRAST) return c;
  }
  return ink;
}

/** Home colours for a background hex (null or invalid input falls back to the default 奶白). */
export function fieldFor(bg: string | null | undefined): FieldColors {
  const hex = bg && isHexColor(bg) ? bg.toUpperCase() : DEFAULT_FIELD_COLOR;
  const fixed = FIXED[hex];
  if (fixed) return { bg: hex, ...fixed };
  const dark = darkTint(hex);
  const light = lightInk(hex);
  const ink = contrastRatio(dark, hex) >= contrastRatio(light, hex) ? dark : light;
  return { bg: hex, ink, ink2: softer(ink, hex) };
}

/** True when no text colour reaches 4.5:1 on `bg` (mid-tones). */
export function contrastWarning(bg: string): boolean {
  if (!isHexColor(bg)) return false;
  const f = fieldFor(bg);
  return contrastRatio(f.ink, f.bg) < MIN_CONTRAST || contrastRatio(f.ink2, f.bg) < MIN_CONTRAST;
}
