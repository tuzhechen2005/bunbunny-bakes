import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DUR, EASE, EASE_IN, EASE_INOUT } from "@/lib/motion/ease";

const css = readFileSync("src/app/globals.css", "utf8");
const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
const token = (name: string) => norm(new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1] ?? "");

describe("motion tokens", () => {
  it("TS constants match the CSS custom properties", () => {
    expect(token("--ease")).toBe(norm(EASE));
    expect(token("--ease-in")).toBe(norm(EASE_IN));
    expect(token("--ease-inout")).toBe(norm(EASE_INOUT));
    for (const n of [1, 2, 3, 4] as const) expect(token(`--dur-${n}`)).toBe(`${DUR[n]}ms`);
  });

  it("Tailwind's default transition uses the default duration and easing", () => {
    expect(token("--default-transition-duration")).toBe(`${DUR[2]}ms`);
    expect(token("--default-transition-timing-function")).toBe(norm(EASE));
  });
});
