// Regenerates public/fonts/noto-serif-sc-600.subset.woff2 (npm run fonts).
// Collects every CJK character used in the customer part of src/copy.ts and the seeded product
// names (see scripts/fontChars.mjs), adds printable ASCII and common punctuation, then subsets
// the vendored Noto Serif SC SemiBold (SIL OFL, see assets-src/fonts/OFL.txt).
// Offline: no network access at build or runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import subsetFont from "subset-font";
import { collectFontChars } from "./fontChars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "assets-src/fonts/NotoSerifSC-SemiBold.otf");
const OUT = resolve(root, "public/fonts/noto-serif-sc-600.subset.woff2");

const chars = collectFontChars(root);
const text = [...chars].sort().join("");

const out = await subsetFont(readFileSync(SOURCE), text, { targetFormat: "woff2" });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`${chars.size} characters -> ${OUT} (${(out.length / 1024).toFixed(1)} KB)`);
