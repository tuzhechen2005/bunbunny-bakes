import { describe, expect, it } from "vitest";
import { diffLines, formatValue } from "@/components/admin/logs/diff";

describe("diffLines", () => {
  it("lists only the changed keys with Chinese labels", () => {
    const lines = diffLines(
      { pickupNote: "a", deliveryFeeCents: 500, maxQtyPerItem: 8 },
      { pickupNote: "b", deliveryFeeCents: 550, maxQtyPerItem: 8 },
    );
    expect(lines).toEqual([
      { key: "pickupNote", label: "自提说明", from: "a", to: "b" },
      { key: "deliveryFeeCents", label: "运费", from: "$5", to: "$5.50" },
    ]);
  });

  it("shows booleans and empty values readably", () => {
    expect(diffLines({ showWechatOnHome: false, ownerWechatId: "" }, { showWechatOnHome: true, ownerWechatId: "wx" })).toEqual([
      { key: "showWechatOnHome", label: "首页显示微信号", from: "否", to: "是" },
      { key: "ownerWechatId", label: "店主微信号", from: "（空）", to: "wx" },
    ]);
  });

  it("without a before, lists every after key without an old value", () => {
    expect(diffLines(null, { status: "NEW", orderNo: "1024-001" })).toEqual([
      { key: "status", label: "状态", from: null, to: "NEW" },
      { key: "orderNo", label: "订单号", from: null, to: "1024-001" },
    ]);
  });

  it("keeps unknown keys as they are, and handles keys missing on one side", () => {
    expect(diffLines({ x: 1 }, { y: 2 })).toEqual([
      { key: "x", label: "x", from: "1", to: "（空）" },
      { key: "y", label: "y", from: "（空）", to: "2" },
    ]);
  });

  it("compares nested values structurally and clips long ones", () => {
    expect(diffLines({ items: [{ qty: 1 }] }, { items: [{ qty: 1 }] })).toEqual([]);
    expect(formatValue("items", [{ n: "x".repeat(200) }]).length).toBeLessThanOrEqual(81);
  });

  it("returns nothing for non-object snapshots", () => {
    expect(diffLines(null, null)).toEqual([]);
    expect(diffLines("a", [1])).toEqual([]);
  });

  it("does not treat prototype keys as known labels", () => {
    expect(diffLines({}, { constructor: 1 })[0].label).toBe("constructor");
  });
});
