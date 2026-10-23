// Characters the serif subset must contain. Shared by scripts/subset-font.mjs and the unit test
// tests/unit/motion/fontSubset.test.ts, so the two can never disagree.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const INPUTS = ["src/copy.ts", "prisma/seed.ts"];

// CJK ideographs, CJK symbols/punctuation, full-width forms, general punctuation.
const NON_ASCII = /[　-〿㐀-鿿＀-￯—‘’“”…·]/gu;

/** @param {string} root repository root */
export function collectFontChars(root) {
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
  return chars;
}
