import { describe, expect, it } from "vitest";
import { chicagoTime, diffLines, formatValue } from "@/components/admin/logs/diff";

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

  it("without a before, lists every after key without an old value, English enums in Chinese", () => {
    expect(diffLines(null, { status: "NEW", orderNo: "1024-001", source: "WEB", fulfillment: "DELIVERY" })).toEqual([
      { key: "status", label: "状态", from: null, to: "新订单" },
      { key: "orderNo", label: "订单号", from: null, to: "1024-001" },
      { key: "source", label: "来源", from: null, to: "顾客下单" },
      { key: "fulfillment", label: "取货方式", from: null, to: "配送" },
    ]);
  });

  it("a creation does not list empty values (no 备注：无) or bookkeeping times", () => {
    const lines = diffLines(null, {
      orderNo: "1024-001",
      note: "",
      cutoffAt: "2026-10-23T01:00:00.000Z",
      paidAt: null,
      imageUrl: null,
    });
    expect(lines.map((l) => l.key)).toEqual(["orderNo"]);
    // ... but clearing an existing note is a change worth showing.
    expect(diffLines({ note: "少糖" }, { note: "" })).toEqual([
      { key: "note", label: "备注", from: "少糖", to: "（空）" },
    ]);
  });

  it("formats order money, items, dates and the delivery wording of READY", () => {
    const lines = diffLines(
      { status: "BAKING", items: [{ name: "奶酪角", qty: 3, lineTotalCents: 600 }] },
      {
        status: "READY",
        items: [
          { productId: "p1", name: "奶酪角", qty: 3, lineTotalCents: 600 },
          { productId: "p2", name: "红豆包", qty: 1, lineTotalCents: 249 },
        ],
        totalCents: 1349,
      },
      { fulfillment: "DELIVERY" },
    );
    expect(lines).toEqual([
      { key: "status", label: "状态", from: "制作中", to: "配送中" },
      { key: "items", label: "商品", from: "奶酪角 ×3", to: "奶酪角 ×3、红豆包 ×1" },
      { key: "totalCents", label: "总额", from: "（空）", to: "$13.49" },
    ]);
    expect(formatValue("status", "READY")).toBe("可取货");
    expect(formatValue("pickupDate", "2026-10-30")).toBe("10/30 周五");
  });

  it("turns ISO instants into Chicago wall time", () => {
    expect(chicagoTime("2026-10-24T01:05:00.000Z")).toBe("10/23 20:05"); // CDT
    expect(chicagoTime("2026-12-01T03:05:00Z")).toBe("11/30 21:05"); // CST
    expect(formatValue("whatever", "2026-10-24T01:05:00.000Z")).toBe("10/23 20:05");
    expect(formatValue("paidAt", null)).toBe("（空）");
  });

  it("never prints raw JSON: limits by name, violations in Chinese, objects as text", () => {
    const names = { p1: "焦糖布蕾" };
    expect(formatValue("productLimits", { p1: 12 }, { productNames: names })).toBe("焦糖布蕾 12");
    expect(formatValue("productLimits", { gone: 3 }, { productNames: names })).toBe("已下架商品 3");
    expect(formatValue("productLimits", {})).toBe("（空）");
    expect(
      formatValue("violations", [{ kind: "PRODUCT", date: "2026-10-30", productId: "p1", after: 30, limit: 24, over: 6 }], {
        productNames: names,
      }),
    ).toContain("焦糖布蕾");
    for (const v of [{ a: 1, b: [2, 3] }, [1, "x"], [{ x: 1 }]]) {
      expect(formatValue("misc", v)).not.toMatch(/[{}[\]"]/);
    }
  });

  it("manual income and product changes read naturally", () => {
    expect(
      diffLines(null, {
        date: "2026-11-02",
        amountCents: 1250,
        note: "现场售卖",
        paidMethod: "CASH",
        items: [{ productId: null, name: "奶酪角", qty: 2 }],
      }).map((l) => [l.label, l.to]),
    ).toEqual([
      ["日期", "11/2 周一"],
      ["金额", "$12.50"],
      ["备注", "现场售卖"],
      ["付款方式", "现金"],
      ["商品", "奶酪角 ×2"],
    ]);
    expect(
      diffLines(
        { id: "x", capacityMode: "DOUGH_PER_UNIT", status: "ACTIVE", updatedAt: "2026-10-01T00:00:00Z" },
        { id: "x", capacityMode: "INDEPENDENT", status: "PAUSED", updatedAt: "2026-10-02T00:00:00Z" },
      ),
    ).toEqual([
      { key: "capacityMode", label: "名额方式", from: "按个算面团", to: "独立限额" },
      { key: "status", label: "状态", from: "在售", to: "暂停" },
    ]);
  });

  it("product reorder lists the names in order", () => {
    const names = { a: "红豆包", b: "奶酪角" };
    expect(
      diffLines(
        [
          { id: "a", sortOrder: 1 },
          { id: "b", sortOrder: 2 },
        ],
        [
          { id: "b", sortOrder: 1 },
          { id: "a", sortOrder: 2 },
        ],
        { productNames: names },
      ),
    ).toEqual([{ key: "order", label: "商品顺序", from: "红豆包 → 奶酪角", to: "奶酪角 → 红豆包" }]);
  });

  it("keeps unknown keys as they are, and handles keys missing on one side", () => {
    expect(diffLines({ x: 1 }, { y: 2 })).toEqual([
      { key: "x", label: "x", from: "1", to: "（空）" },
      { key: "y", label: "y", from: "（空）", to: "2" },
    ]);
  });

  it("compares nested values structurally and clips long free text only", () => {
    expect(diffLines({ items: [{ qty: 1 }] }, { items: [{ qty: 1 }] })).toEqual([]);
    expect(formatValue("note", "x".repeat(300)).length).toBeLessThanOrEqual(121);
  });

  it("returns nothing for non-object snapshots", () => {
    expect(diffLines(null, null)).toEqual([]);
    expect(diffLines("a", [1])).toEqual([]);
  });

  it("does not treat prototype keys as known labels", () => {
    expect(diffLines({}, { constructor: 1 })[0].label).toBe("constructor");
  });

  it("never throws on date-shaped strings that are not real dates", () => {
    for (const v of ["2026-02-30", "2026-13-45", "0000-00-00"]) {
      expect(() => formatValue("note", v)).not.toThrow();
      expect(formatValue("note", v)).toBe(v);
      expect(() => diffLines(null, { note: v })).not.toThrow();
    }
  });
});
