import { describe, expect, it } from "vitest";
import { FIELDS } from "@/lib/field";
import {
  contrastRatio,
  contrastWarning,
  DEFAULT_FIELD_COLOR,
  FIELD_PRESETS,
  fieldFor,
  isHexColor,
} from "@/lib/fieldColor";

describe("fieldFor", () => {
  it.each(FIELDS.map((f) => [f.field, f]))("keeps the current pair for %s exactly", (_n, f) => {
    expect(fieldFor(f.field)).toEqual({ bg: f.field, ink: f.ink, ink2: f.ink2 });
    expect(fieldFor(f.field.toLowerCase())).toEqual({ bg: f.field, ink: f.ink, ink2: f.ink2 });
  });

  it("falls back to 奶白 for null or garbage", () => {
    expect(fieldFor(null).bg).toBe(DEFAULT_FIELD_COLOR);
    expect(fieldFor("red").bg).toBe(DEFAULT_FIELD_COLOR);
  });

  it.each(FIELD_PRESETS.map((p) => [p.name, p.hex]))("preset %s: ink and ink2 reach 4.5:1", (_n, hex) => {
    const f = fieldFor(hex);
    expect(contrastRatio(f.ink, f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(f.ink2, f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastWarning(hex)).toBe(false);
  });

  it("has 10 presets with unique, valid hex values", () => {
    expect(FIELD_PRESETS).toHaveLength(10);
    expect(new Set(FIELD_PRESETS.map((p) => p.hex)).size).toBe(10);
    expect(FIELD_PRESETS.every((p) => isHexColor(p.hex))).toBe(true);
  });

  it("picks light ink on dark colours and dark ink on light ones", () => {
    expect(fieldFor("#3A3633").ink).toBe("#FFF8EE");
    expect(contrastRatio(fieldFor("#3A3633").ink, "#3A3633")).toBeGreaterThan(8);
    expect(fieldFor("#FFFFFF").ink).not.toBe("#FFF8EE");
  });

  it("computes ratios the WCAG way", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("no warning on mid-tones: black or white always reaches 4.5:1 (max is 4.58)", () => {
    expect(contrastWarning("#787878")).toBe(false);
    expect(contrastWarning("#FFFFFF")).toBe(false);
  });

  it.each(["#787878", "#777777", "#006EFF"])("%s: ink reaches 4.5:1 whenever black or white does", (hex) => {
    const f = fieldFor(hex);
    const best = Math.max(contrastRatio("#000000", hex), contrastRatio("#FFFFFF", hex));
    expect(contrastWarning(hex)).toBe(best < 4.5);
    if (best >= 4.5) {
      expect(contrastRatio(f.ink, hex)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(f.ink2, hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("property: warning if and only if neither black nor white reaches 4.5:1", () => {
    const hexes: string[] = [];
    for (let i = 1; i <= 3000; i++) hexes.push("#" + (((i * 2654435761) >>> 0) % 0x1000000).toString(16).padStart(6, "0").toUpperCase());
    for (let v = 0; v <= 255; v++) hexes.push("#" + v.toString(16).padStart(2, "0").repeat(3).toUpperCase());
    for (const hex of hexes) {
      const best = Math.max(contrastRatio("#000000", hex), contrastRatio("#FFFFFF", hex));
      expect(contrastWarning(hex), hex).toBe(best < 4.5);
    }
  });

  it("every sampled colour either reaches 4.5:1 or warns", () => {
    for (let i = 1; i <= 400; i++) {
      const hex = "#" + (((i * 2654435761) >>> 0) % 0x1000000).toString(16).padStart(6, "0");
      const f = fieldFor(hex);
      const ok = contrastRatio(f.ink, f.bg) >= 4.5 && contrastRatio(f.ink2, f.bg) >= 4.5;
      expect(ok || contrastWarning(hex)).toBe(true);
    }
  });
});
