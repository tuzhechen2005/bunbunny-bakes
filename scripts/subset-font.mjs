// Regenerates public/fonts/noto-serif-sc-600.subset.woff2 (npm run fonts).
// Collects every CJK character used in src/copy.ts and the seeded product names
// (prisma/seed.ts), adds printable ASCII and common CJK/full-width punctuation, then
// subsets the vendored Noto Serif SC SemiBold (SIL OFL, see assets-src/fonts/OFL.txt).
// Offline: no network access at build or runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import subsetFont from "subset-font";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "assets-src/fonts/NotoSerifSC-SemiBold.otf");
const OUT = resolve(root, "public/fonts/noto-serif-sc-600.subset.woff2");
const INPUTS = ["src/copy.ts", "prisma/seed.ts"];

// CJK ideographs, CJK symbols/punctuation, full-width forms, general punctuation.
const NON_ASCII = /[　-〿㐀-鿿＀-￯—‘’“”…·]/gu;

const chars = new Set();
for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
for (const file of INPUTS) {
  let text = readFileSync(resolve(root, file), "utf8");
  // The serif face is for customer headings; the admin copy block falls back to the system font.
  if (file === "src/copy.ts") text = text.split(/^ {2}admin: \{/m)[0];
  // Seed: only the product names (descriptions live in the database and are body text).
  if (file === "prisma/seed.ts") text = [...text.matchAll(/^\s*name: "([^"]*)"/gm)].map((m) => m[1]).join("");
  for (const m of text.matchAll(NON_ASCII)) chars.add(m[0]);
}
const text = [...chars].sort().join("");

const out = await subsetFont(readFileSync(SOURCE), text, { targetFormat: "woff2" });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`${chars.size} characters -> ${OUT} (${(out.length / 1024).toFixed(1)} KB)`);
