import { describe, expect, it } from "vitest";
import { itemsSummary } from "@/server/orderQueries";
import { flavorSummaryText } from "@/server/flavorText";

describe("F3 null-flavour display", () => {
  it("uses plain product names for null/omitted flavours and preserves named flavours", () => {
    expect(itemsSummary([
      { nameSnapshot: "奶酥红豆包", flavorName: null, qty: 1 },
      { nameSnapshot: "奶酪角", qty: 2 },
      { nameSnapshot: "焦糖布蕾", flavorName: null, qty: 3 },
      { nameSnapshot: "泡芙", flavorName: "原味", qty: 5 },
    ])).toBe("奶酥红豆包×1、奶酪角×2、焦糖布蕾×3、泡芙（原味）×5");
    expect(itemsSummary([])).toBe("");
  });

  it("lists named flavours before the combined null-flavour quantity with caller units", () => {
    const flavors = [
      { flavorId: null, flavorName: null, qty: 1 },
      { flavorId: "original", flavorName: "原味", qty: 5 },
      { flavorId: "legacy", flavorName: null, qty: 1 },
    ];
    expect(flavorSummaryText("泡芙", flavors, 7, "个")).toBe("泡芙：原味 5个、其他 2个，共 7个");
    expect(flavorSummaryText("泡芙", flavors, 7)).toBe("泡芙：原味 5、其他 2，共 7");
  });

  it("preserves named-only summaries and labels a wholly null flavour breakdown", () => {
    expect(flavorSummaryText("泡芙", [{ flavorId: "a", flavorName: "原味", qty: 5 }], 5, "个"))
      .toBe("泡芙：原味 5个，共 5个");
    expect(flavorSummaryText("泡芙", [{ flavorId: null, flavorName: null, qty: 2 }], 2, "个"))
      .toBe("泡芙：其他 2个，共 2个");
  });
});
