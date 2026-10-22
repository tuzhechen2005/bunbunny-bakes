// POST /api/availability (API_SPEC §2). Display only: reads, never locks or writes.

import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { listAvailability } from "@/domain/availability";
import { priceCart } from "@/domain/pricing";
import { loadAvailabilityInput } from "@/server/availabilityData";
import { prisma } from "@/server/db";
import { jsonError, requireJsonContentType } from "@/server/http";
import { MAX_LINES, MAX_QTY_SCHEMA } from "@/server/orderSchemas";
import { mergeLines } from "@/server/orders";
import { parseJsonBody } from "@/server/session";

const Body = z.object({
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        qty: z.number().int().min(1).max(MAX_QTY_SCHEMA),
      }),
    )
    .min(1)
    .max(MAX_LINES),
  fulfillment: z.enum(["PICKUP", "DELIVERY"]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireJsonContentType(request);
    const body = await parseJsonBody(request, Body);
    await connection();
    const now = new Date();
    const cart = mergeLines(body.items);
    const input = await loadAvailabilityInput(prisma, { cart, fulfillment: body.fulfillment, now });
    const result = listAvailability(input);

    // Unknown and archived products are not priced; cartProblems already reports them.
    const [settings, products] = await Promise.all([
      prisma.setting.findUniqueOrThrow({
        where: { id: 1 },
        select: { deliveryFeeCents: true, freeDeliveryMinCents: true },
      }),
      prisma.product.findMany({
        where: { id: { in: cart.map((l) => l.productId) }, status: { not: "ARCHIVED" } },
        select: { id: true, unitPriceCents: true, bundleSize: true, bundlePriceCents: true },
      }),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const pricing = priceCart(
      cart.flatMap((l) => {
        const p = byId.get(l.productId);
        return p
          ? [
              {
                productId: l.productId,
                qty: l.qty,
                price: {
                  unitPriceCents: p.unitPriceCents,
                  bundleSize: p.bundleSize,
                  bundlePriceCents: p.bundlePriceCents,
                },
              },
            ]
          : [];
      }),
      body.fulfillment,
      settings,
    );

    return NextResponse.json({
      orderingEnabled: result.orderingEnabled,
      pricing: {
        subtotalCents: pricing.subtotalCents,
        deliveryFeeCents: pricing.deliveryFeeCents,
        totalCents: pricing.totalCents,
        freeDeliveryGapCents: pricing.freeDeliveryGapCents,
      },
      cartProblems: result.cartProblems,
      dates: result.dates.map((d) =>
        d.state === "AVAILABLE"
          ? { date: d.date, state: d.state, cutoffAt: d.cutoffAt.toISOString(), cutoffLabel: d.cutoffLabel }
          : { date: d.date, state: d.state },
      ),
    });
  } catch (e) {
    return jsonError(e);
  }
}
