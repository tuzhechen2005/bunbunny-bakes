// POST /api/cron/outbox (API_SPEC §4), every 5 minutes from cron-job.org.
// Sends due notifications, then runs cleanup. Safe to call repeatedly.

import { connection, NextResponse } from "next/server";
import { requireCron } from "@/server/cron";
import { prisma } from "@/server/db";
import { cleanup } from "@/server/maintenance";
import { processOutbox } from "@/server/outboxSend";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;
  try {
    await connection();
    const now = new Date();
    const outbox = await processOutbox(prisma, now);
    const cleaned = await cleanup(prisma, now);
    return NextResponse.json({ outbox, cleanup: cleaned });
  } catch (e) {
    console.error("cron outbox failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "INTERNAL", message: "internal error" }, { status: 500 });
  }
}
