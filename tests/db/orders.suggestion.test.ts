// FULL still returns FULL (suggestion null) when computing the suggestion fails.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@/copy";
import { AppError } from "@/server/errors";
import * as availabilityData from "@/server/availabilityData";
import { createCustomerOrder } from "@/server/orders";
import { createDefaultProducts, createOpenDate, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

// Wrap the real loader in a spy so a test can make it fail.
vi.mock("@/server/availabilityData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/availabilityData")>();
  return { ...actual, loadAvailabilityInput: vi.fn(actual.loadAvailabilityInput) };
});

const DATE = "2026-10-30";
const NOW = new Date("2026-10-27T15:00:00Z");
let P: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  vi.mocked(availabilityData.loadAvailabilityInput).mockClear();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
});

async function fullError(): Promise<AppError> {
  await createOpenDate(DATE, { doughLimitG: 0 });
  await createOpenDate("2026-10-31");
  try {
    await createCustomerOrder(
      db,
      { items: [{ productId: P.redBean, qty: 1 }], pickupDate: DATE, fulfillment: "PICKUP", wechatId: "wx_s", ipHash: "ip_s" },
      NOW,
    );
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected FULL");
}

describe("FULL suggestion failure", () => {
  it("with the real loader, the suggestion is computed (spy is a pass-through)", async () => {
    const e = await fullError();
    expect(e.code).toBe("FULL");
    expect(e.extra).toEqual({ suggestion: "2026-10-31" });
    expect(availabilityData.loadAvailabilityInput).toHaveBeenCalledTimes(1);
  });

  it("if loading availability throws, FULL is still returned with suggestion null and the error is logged", async () => {
    vi.mocked(availabilityData.loadAvailabilityInput).mockRejectedValueOnce(new Error("db hiccup"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const e = await fullError();
      expect(e.code).toBe("FULL");
      expect(e.extra).toEqual({ suggestion: null });
      expect(e.message).toBe(copy.errors.FULL_NO_SUGGESTION);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0].join(" "))).toContain("db hiccup");
    } finally {
      log.mockRestore();
    }
    expect(await db.order.count()).toBe(0);
  });
});
