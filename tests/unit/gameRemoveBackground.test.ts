import { describe, expect, it } from "vitest";
import { classifyImage, removeWhiteBackground } from "@/components/admin/game/removeBackground";

function make(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}
const inDisc = (x: number, y: number) => (x - 20) ** 2 + (y - 20) ** 2 <= 100;
const bread: [number, number, number, number] = [180, 110, 50, 255];

describe("classifyImage", () => {
  it("detects a real transparent background", () => {
    const d = make(40, 40, (x, y) => (inDisc(x, y) ? bread : [0, 0, 0, 0]));
    expect(classifyImage(d, 40, 40)).toBe("alpha");
  });
  it("detects a painted checkerboard", () => {
    const d = make(40, 40, (x, y) => {
      if (inDisc(x, y)) return bread;
      const v = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 255 : 204;
      return [v, v, v, 255];
    });
    expect(classifyImage(d, 40, 40)).toBe("fake-checker");
  });
  it("treats a plain white background as opaque", () => {
    const d = make(40, 40, (x, y) => (inDisc(x, y) ? bread : [255, 255, 255, 255]));
    expect(classifyImage(d, 40, 40)).toBe("opaque");
  });
  it("does not mistake a dark photo for a checkerboard", () => {
    expect(classifyImage(make(40, 40, () => [30, 30, 30, 255]), 40, 40)).toBe("opaque");
  });
});

describe("removeWhiteBackground", () => {
  it("clears the outside, keeps the bread, feathers the edge", () => {
    const d = make(40, 40, (x, y) => (inDisc(x, y) ? bread : [252, 252, 252, 255]));
    const { data, removedFraction } = removeWhiteBackground(d, 40, 40);
    expect(data[3]).toBe(0);
    expect(data[(20 * 40 + 20) * 4 + 3]).toBe(255);
    const rim = data[(20 * 40 + 30) * 4 + 3];
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(255);
    expect(removedFraction).toBeGreaterThan(0.5);
  });
  it("keeps white enclosed by the bread", () => {
    const d = make(40, 40, (x, y) => {
      if ((x - 20) ** 2 + (y - 20) ** 2 <= 9) return [255, 255, 255, 255];
      return inDisc(x, y) ? bread : [255, 255, 255, 255];
    });
    expect(removeWhiteBackground(d, 40, 40).data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });
});
