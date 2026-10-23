// Regenerates the self-hosted font subsets (npm run fonts). Run it again whenever src/copy.ts gains
// new characters (tests/unit/motion/fontSubset.test.ts fails if a character is missing).
//
// - public/fonts/noto-sans-sc-900.subset.woff2: Noto Sans SC pinned to weight 900 (display: slogan,
//   product names, page titles). Characters: the customer part of src/copy.ts and the seeded product
//   names (scripts/fontChars.mjs), plus printable ASCII. Body text uses the system font.
// - public/fonts/fraunces-num.subset.woff2: Fraunces pinned to SOFT 100 / WONK 0 / opsz 72 / wght 700
//   (prices, dates, order numbers). Printable ASCII and "×".
//
// The variable source fonts (SIL OFL, see assets-src/fonts/OFL*.txt) are large, so they are not in
// git: they are downloaded once into assets-src/fonts/.cache and checked against a pinned sha256.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import subsetFont from "subset-font";
import { collectFontChars } from "./fontChars.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(root, "assets-src/fonts/.cache");
const REV = "e7db6ca603fd4862010383ff17ffd6cc4ffac1c0"; // github.com/google/fonts
const SOURCES = {
  sans: {
    file: "NotoSansSC[wght].ttf",
    url: `https://raw.githubusercontent.com/google/fonts/${REV}/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf`,
    sha256: "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
  },
  num: {
    file: "Fraunces[SOFT,WONK,opsz,wght].ttf",
    url: `https://raw.githubusercontent.com/google/fonts/${REV}/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf`,
    sha256: "177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb",
  },
};

async function source({ file, url, sha256 }) {
  const path = resolve(CACHE, file);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(path);
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha256) throw new Error(`${file}: sha256 ${got} does not match the pinned ${sha256}`);
  return buf;
}

let ascii = "";
for (let c = 0x20; c < 0x7f; c++) ascii += String.fromCharCode(c);

const jobs = [
  {
    src: SOURCES.sans,
    text: [...collectFontChars(root)].sort().join(""),
    axes: { wght: 900 },
    out: "public/fonts/noto-sans-sc-900.subset.woff2",
  },
  {
    src: SOURCES.num,
    text: ascii + "×",
    axes: { SOFT: 100, WONK: 0, opsz: 72, wght: 700 },
    out: "public/fonts/fraunces-num.subset.woff2",
  },
];

for (const job of jobs) {
  const out = await subsetFont(await source(job.src), job.text, { targetFormat: "woff2", variationAxes: job.axes });
  const path = resolve(root, job.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  console.log(`${[...job.text].length} characters -> ${job.out} (${(out.length / 1024).toFixed(1)} KB)`);
}
