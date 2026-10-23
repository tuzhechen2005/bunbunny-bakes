import { describe, expect, it } from "vitest";
import { cardSize, pitch, ropeSag, slot } from "@/components/customer/rack/layout";

describe("rack layout", () => {
  it("sizes the centre card from the stage width within bounds", () => {
    expect(cardSize(375)).toBe(225);
    expect(cardSize(320)).toBe(192);
    expect(cardSize(100)).toBe(140);
    expect(cardSize(2000)).toBe(280);
  });

  it("centre card is largest, faces front and is on top", () => {
    const c = slot(0, 220);
    expect(c).toMatchObject({ x: 0, scale: 1, opacity: 1, z: 100 });
    expect(Math.abs(c.rotateY)).toBe(0);
    for (const d of [-2, -1, -0.5, 0.5, 1, 2]) {
      expect(slot(d, 220).scale).toBeLessThan(1);
      expect(slot(d, 220).z).toBeLessThan(100);
    }
  });

  it("is mirror symmetric and side cards turn toward the centre", () => {
    const r = slot(1, 220);
    const l = slot(-1, 220);
    expect(l.x).toBeCloseTo(-r.x);
    expect(l.scale).toBeCloseTo(r.scale);
    expect(r.rotateY).toBeLessThan(0);
    expect(l.rotateY).toBeGreaterThan(0);
    expect(l.rotateY).toBeCloseTo(-r.rotateY);
  });

  it("near spacing is larger than far spacing", () => {
    const s = 220;
    const near = slot(1, s).x - slot(0, s).x;
    const far = slot(2, s).x - slot(1, s).x;
    expect(near).toBeGreaterThan(far * 2);
    expect(far).toBeGreaterThan(0);
  });

  it("is continuous and monotone while the rope moves", () => {
    let prev = slot(0, 220);
    for (let d = 0.05; d <= 4; d += 0.05) {
      const s = slot(d, 220);
      expect(s.x).toBeGreaterThan(prev.x);
      expect(s.scale).toBeLessThanOrEqual(prev.scale + 1e-9);
      expect(Math.abs(s.x - prev.x)).toBeLessThan(220 * 0.78 * 0.06);
      prev = s;
    }
  });

  it("hides cards that are far off stage", () => {
    expect(slot(3, 220).visible).toBe(true);
    expect(slot(4, 220).visible).toBe(false);
  });

  it("pitch is the neighbour distance and the rope sags in the middle only", () => {
    expect(pitch(200)).toBeCloseTo(slot(1, 200).x);
    expect(ropeSag(0, 375, 10)).toBe(10);
    expect(ropeSag(187.5, 375, 10)).toBeCloseTo(0);
    expect(ropeSag(400, 375, 10)).toBe(0);
  });
});
