import { describe, expect, it } from "vitest";
import { systemPrompt } from "@/server/assistant/prompt";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "@/server/assistant/tools";
import { fieldFor } from "@/lib/fieldColor";

function context(): ToolContext {
  return {
    menu: {
      orderingEnabled: true, pickupNote: "", deliveryFeeCents: 500,
      freeDeliveryMinCents: 2500, maxQtyPerItem: 10,
      products: [{ id: "bread", name: "Bread", description: "", imageUrl: null, images: [],
        field: fieldFor(null), flavors: [], isNew: false, priceFromCents: 600,
        unitPriceCents: 600, bundleSize: 1, bundlePriceCents: null,
        status: "ACTIVE", leadDays: 1, pickupWeekdays: [] }],
    },
    availability: { now: new Date("2026-11-08T18:00:00Z"), orderingEnabled: true,
      cutoffTime: "20:00", maxQtyPerItem: 10, products: {}, cart: [], fulfillment: "PICKUP", days: [] },
    fulfillment: "PICKUP",
  };
}

describe("customer-confirmed order card contract", () => {
  it("requires a customer's own confirmation and preserves the PII restriction", () => {
    const ctx = context();
    const prompt = systemPrompt({ menu: ctx.menu, now: ctx.availability.now,
      cutoffTime: "20:00", cart: [], fulfillment: "PICKUP" });
    expect(prompt).toContain("绝不说已经帮顾客下单或保留了名额");
    expect(prompt).toContain("你不能调用下单接口");
    expect(prompt).toContain("在卡片上填写微信号");
    expect(prompt).toContain("亲自点「确认下单」");
    expect(prompt).toContain("不要询问或复述微信号、电话、地址");
    expect(prompt).not.toContain("放进纸袋");
    expect(TOOL_DEFINITIONS.map(t => t.function.name)).toEqual(["get_menu", "check_date", "find_dates", "propose_cart"]);
  });

  it.each([undefined, "PICKUP", "DELIVERY"])("returns optional fulfillment %s and prices accordingly", fulfillment => {
    const ctx = context();
    const result = runTool(ctx, "propose_cart", JSON.stringify({
      items: [{ product: "p1", qty: 2 }], note: "", fulfillment,
    }));
    expect(ctx.suggestion).toEqual({ items: [{ productId: "bread", qty: 2 }], date: null, note: "",
      ...(fulfillment ? { fulfillment } : {}) });
    expect(result).toMatchObject({ ok: true, 小计: "$12.00",
      ...(fulfillment === "DELIVERY" ? { 运费: "$5.00", 合计: "$17.00" } : {}) });
  });

  it.each(["SHIP", null, 1, ""])("rejects fulfillment %s", fulfillment => {
    const ctx = context();
    expect(runTool(ctx, "propose_cart", JSON.stringify({
      items: [{ product: "p1", qty: 1 }], note: "", fulfillment,
    }))).toMatchObject({ error: expect.any(String) });
    expect(ctx.suggestion).toBeUndefined();
  });
});
