/**
 * The home hero takes the colour of the bread on the rope (D76). Colours cycle by menu position,
 * so the four current products keep these and a new product simply takes the next one.
 * `field` is the background, `ink` the text and buttons on it.
 */
export interface Field {
  field: string;
  ink: string;
}

export const FIELDS: readonly Field[] = [
  { field: "#DCC5BB", ink: "#4A2723" }, // red bean: pale adzuki
  { field: "#F0BF45", ink: "#36260A" }, // rock cheese: cheese yellow
  { field: "#CFDDEA", ink: "#1B2C44" }, // cheese horn: milk blue
  { field: "#C6601C", ink: "#FFF0DF" }, // brulee: caramel
];

export function fieldFor(index: number): Field {
  const n = FIELDS.length;
  return FIELDS[((Math.trunc(index) % n) + n) % n];
}

/** Apply a field to the document (the registered --field/--fink properties animate the change). */
export function applyField(f: Field): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--field", f.field);
  s.setProperty("--fink", f.ink);
}
