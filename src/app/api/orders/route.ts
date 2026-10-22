// POST /api/orders (API_SPEC §2). Public. Amounts sent by the client are never read:
// only the whitelisted fields below reach createCustomerOrder, which prices on the server.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { clientIp, jsonError, requireJsonContentType } from "@/server/http";
import { createCustomerOrder, type CreateOrderInput } from "@/server/orders";
import { hashIp } from "@/server/tokens";

function honeypotTripped(website: unknown): boolean {
  return website !== undefined && website !== null && website !== "";
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireJsonContentType(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("VALIDATION", { extra: { fields: {} } });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("VALIDATION", { extra: { fields: {} } });
    }
    const b = body as Record<string, unknown>;

    // Bots fill the hidden field. Generic message, nothing written.
    if (honeypotTripped(b.website)) {
      throw new AppError("VALIDATION", { message: copy.errors.fallback, extra: { fields: {} } });
    }

    const secret = process.env.IP_HASH_SECRET;
    if (!secret) {
      console.error("POST /api/orders: IP_HASH_SECRET is not set; refusing to take orders");
      return NextResponse.json({ error: "INTERNAL", message: copy.errors.fallback }, { status: 500 });
    }
    const ipHash = hashIp(clientIp(request), secret);

    await connection();
    const now = new Date();
    // Whitelist: nothing but these fields is read; createCustomerOrder validates them with Zod.
    const input = {
      items: b.items,
      pickupDate: b.pickupDate,
      fulfillment: b.fulfillment,
      wechatId: b.wechatId,
      note: b.note,
      idempotencyKey: b.idempotencyKey,
      ipHash,
    } as unknown as CreateOrderInput;
    const created = await createCustomerOrder(prisma, input, now);

    // notify: send notificationId after commit (M6)
    void created.notificationId;

    return NextResponse.json(
      { orderNo: created.orderNo, viewToken: created.viewToken, url: `/o/${created.viewToken}` },
      { status: created.replayed ? 200 : 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
