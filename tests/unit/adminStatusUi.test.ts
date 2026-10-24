import { describe, expect, it } from "vitest";
import { forwardChoices, moveToLabel, skippedSteps, statusLabel } from "@/components/admin/orders/statusUi";

describe("admin status wording", () => {
  it("READY reads 可取货 for pickup and 配送中 for delivery; other steps do not change", () => {
    expect(statusLabel("READY", "PICKUP")).toBe("可取货");
    expect(statusLabel("READY")).toBe("可取货");
    expect(statusLabel("READY", "DELIVERY")).toBe("配送中");
    expect(statusLabel("BAKING", "DELIVERY")).toBe("制作中");
    expect(moveToLabel("READY", "PICKUP")).toBe("标为可取货");
    expect(moveToLabel("READY", "DELIVERY")).toBe("标为配送中");
    expect(moveToLabel("COMPLETED", "DELIVERY")).toBe("标为已完成");
  });
});

describe("forwardChoices", () => {
  it("only the very next step is prominent, later ones are jumps", () => {
    expect(forwardChoices("NEW", ["CONTACTED", "CONFIRMED", "BAKING", "READY", "COMPLETED"])).toEqual({
      next: "CONTACTED",
      jumps: ["CONFIRMED", "BAKING", "READY", "COMPLETED"],
    });
    expect(forwardChoices("READY", ["COMPLETED"])).toEqual({ next: "COMPLETED", jumps: [] });
    expect(forwardChoices("COMPLETED", [])).toEqual({ next: null, jumps: [] });
  });

  it("names the steps a jump skips", () => {
    expect(skippedSteps("CONFIRMED", "COMPLETED")).toEqual(["BAKING", "READY"]);
    expect(skippedSteps("BAKING", "READY")).toEqual([]);
  });
});
