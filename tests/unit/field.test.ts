import { describe, expect, it } from "vitest";
import { FIELDS, fieldFor } from "@/lib/field";

describe("fieldFor", () => {
  it("cycles through the palette by menu position", () => {
    expect(fieldFor(0)).toBe(FIELDS[0]);
    expect(fieldFor(3)).toBe(FIELDS[3]);
    expect(fieldFor(4)).toBe(FIELDS[0]);
    expect(fieldFor(-1)).toBe(FIELDS[FIELDS.length - 1]);
  });
});
