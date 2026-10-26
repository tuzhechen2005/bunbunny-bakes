import { describe, expect, it } from "vitest";
import { FIELDS, fieldFor, productField } from "@/lib/field";

describe("productField (D95)", () => {
  it("uses the colours of the product itself", () => {
    expect(productField({ field: { bg: "#B9C9A0", ink: "#111111", ink2: "#333333" } }, 2)).toEqual({
      field: "#B9C9A0",
      ink: "#111111",
      ink2: "#333333",
    });
  });
  it("falls back to the old cycle when the payload has no field", () => {
    expect(productField({}, 1)).toBe(FIELDS[1]);
    expect(productField({ field: null }, 5)).toBe(FIELDS[1]);
  });
});

describe("fieldFor", () => {
  it("cycles through the palette by menu position", () => {
    expect(fieldFor(0)).toBe(FIELDS[0]);
    expect(fieldFor(3)).toBe(FIELDS[3]);
    expect(fieldFor(4)).toBe(FIELDS[0]);
    expect(fieldFor(-1)).toBe(FIELDS[FIELDS.length - 1]);
  });
});

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("field contrast (D88, WCAG AA)", () => {
  it.each(FIELDS.map((f) => [f.field, f]))("%s: ink and ink2 are readable on the field", (_n, f) => {
    expect(contrast(f.ink, f.field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(f.ink2, f.field)).toBeGreaterThanOrEqual(4.5);
  });
});
