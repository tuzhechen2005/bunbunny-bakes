import { describe, expect, it } from "vitest";
import { copy } from "@/copy";
import { AppError } from "@/server/errors";
import { adminOrderSchema, customerOrderSchema, parseOrThrow } from "@/server/orderSchemas";

const F = copy.errors.fields;
const ok = {
  items: [{ productId: "7b1e3d5a-0c1f-4a43-9d0e-2f0a8a6b9c11", qty: 1 }],
  pickupDate: "2030-01-05",
  fulfillment: "PICKUP",
  wechatId: "wx",
};

function fieldsOf(schema: typeof customerOrderSchema | typeof adminOrderSchema, input: unknown) {
  try {
    parseOrThrow(schema, input);
  } catch (e) {
    return (e as AppError).extra!.fields as Record<string, string>;
  }
  throw new Error("expected VALIDATION");
}

describe("order schema VALIDATION messages", () => {
  it("are Chinese, customer-safe copy", () => {
    expect(fieldsOf(customerOrderSchema, { ...ok, wechatId: "  " })).toEqual({ wechatId: F.wechatId });
    expect(fieldsOf(customerOrderSchema, { ...ok, wechatId: "x".repeat(41) })).toEqual({ wechatId: F.wechatId });
    expect(fieldsOf(customerOrderSchema, { ...ok, note: "n".repeat(301) })).toEqual({ note: F.note });
    expect(fieldsOf(customerOrderSchema, { ...ok, pickupDate: "nope" })).toEqual({ pickupDate: F.pickupDate });
    expect(fieldsOf(customerOrderSchema, { ...ok, items: [{ productId: ok.items[0].productId, qty: 0 }] })).toEqual({
      "items.0.qty": F.qty,
    });
    expect(fieldsOf(customerOrderSchema, { ...ok, items: [] })).toEqual({ items: F.items });
  });

  it("covers built-in zod issues (missing / wrong type) too", () => {
    const fields = fieldsOf(customerOrderSchema, { items: "x", fulfillment: "BOAT" });
    for (const m of Object.values(fields)) expect(m).toMatch(/[一-鿿]/);
    expect(Object.keys(fields).sort()).toEqual(["fulfillment", "items", "pickupDate", "wechatId"]);
  });

  it("admin override without a reason", () => {
    expect(fieldsOf(adminOrderSchema, { ...ok, override: true })).toEqual({ reason: F.reason });
  });
});
