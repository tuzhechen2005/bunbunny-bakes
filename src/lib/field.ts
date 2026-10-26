/**
 * The home hero takes the colour of the bread on the rope (D95: each product's own `field`). The cycle
 * below is only the fallback for a menu payload without one (old cached copies).
 * `field` is the background, `ink` the text and buttons on it, `ink2` the secondary text (a softer
 * ink that still has >= 4.5:1 on its own field, D88; it replaces opacity on the ink).
 * Contrast ink / ink2 on field: 7.94 / 4.99, 8.51 / 5.05, 10.19 / 5.09, 4.90 / 4.62.
 */
export interface Field {
  field: string;
  ink: string;
  ink2: string;
}

export const FIELDS: readonly Field[] = [
  { field: "#DCC5BB", ink: "#4A2723", ink2: "#674741" }, // red bean: pale adzuki
  { field: "#F0BF45", ink: "#36260A", ink2: "#5F4817" }, // rock cheese: cheese yellow
  { field: "#CFDDEA", ink: "#1B2C44", ink2: "#4A5A6F" }, // cheese horn: milk blue
  { field: "#B05219", ink: "#FFF8EE", ink2: "#FFF0DF" }, // brulee: caramel (D88: darker than D76's #C6601C)
];

export function fieldFor(index: number): Field {
  const n = FIELDS.length;
  return FIELDS[((Math.trunc(index) % n) + n) % n];
}

/**
 * The colours of one menu product (D95): its own `field`, or, for an old cached payload without
 * one, the old cycle by menu position.
 */
export function productField(p: { field?: { bg: string; ink: string; ink2: string } | null }, index: number): Field {
  const f = p.field;
  return f && f.bg && f.ink && f.ink2 ? { field: f.bg, ink: f.ink, ink2: f.ink2 } : fieldFor(index);
}

/** Apply a field to the document; the home page element animates the change (see globals.css `.hm-page`). */
export function applyField(f: Field): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--field", f.field);
  s.setProperty("--fink", f.ink);
  s.setProperty("--fink2", f.ink2);
}
