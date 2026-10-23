import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import subsetFont from "subset-font";
import { describe, expect, it } from "vitest";
import { collectFontChars } from "../../../scripts/fontChars.mjs";

const root = resolve(__dirname, "../../..");

/** Code points in the font's cmap (formats 4 and 12), read from an uncompressed sfnt. */
function cmapCodePoints(sfnt: Buffer): Set<number> {
  const numTables = sfnt.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (sfnt.toString("ascii", rec, rec + 4) === "cmap") cmapOffset = sfnt.readUInt32BE(rec + 8);
  }
  if (cmapOffset < 0) throw new Error("no cmap table");
  const out = new Set<number>();
  const n = sfnt.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmapOffset + sfnt.readUInt32BE(cmapOffset + 4 + i * 8 + 4);
    const format = sfnt.readUInt16BE(sub);
    if (format === 12) {
      const groups = sfnt.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const o = sub + 16 + g * 12;
        for (let c = sfnt.readUInt32BE(o); c <= sfnt.readUInt32BE(o + 4); c++) out.add(c);
      }
    } else if (format === 4) {
      const segX2 = sfnt.readUInt16BE(sub + 6);
      const endO = sub + 14;
      const startO = endO + segX2 + 2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = sfnt.readUInt16BE(endO + s * 2);
        for (let c = sfnt.readUInt16BE(startO + s * 2); c <= end && c < 0xffff; c++) out.add(c);
      }
    }
  }
  return out;
}

describe("serif font subset", () => {
  it("contains every character used in customer copy and seeded product names (run `npm run fonts` if this fails)", async () => {
    const required = collectFontChars(root);
    const woff2 = readFileSync(resolve(root, "public/fonts/noto-serif-sc-600.subset.woff2"));
    // Re-subsetting to the required text keeps only glyphs the font really has, so what comes
    // back in the cmap is exactly required ∩ present.
    const sfnt = await subsetFont(woff2, [...required].join(""), { targetFormat: "sfnt" });
    const present = cmapCodePoints(Buffer.from(sfnt));
    const missing = [...required].filter((ch) => !present.has(ch.codePointAt(0)!));
    expect(missing.join("")).toBe("");
    expect(required.has("放")).toBe(true); // sanity: the collector sees the brand copy
  });
});
