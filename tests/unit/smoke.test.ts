import { describe, expect, it } from "vitest";
import { OCCUPYING_STATUSES } from "@/domain/types";

describe("OCCUPYING_STATUSES", () => {
  it("has the six capacity-occupying statuses", () => {
    expect([...OCCUPYING_STATUSES].sort()).toEqual(
      ["BAKING", "COMPLETED", "CONFIRMED", "CONTACTED", "NEW", "READY"],
    );
  });

  it("excludes CANCELLED and REJECTED", () => {
    expect(OCCUPYING_STATUSES).not.toContain("CANCELLED");
    expect(OCCUPYING_STATUSES).not.toContain("REJECTED");
  });
});
