// POST /api/cron/summary (API_SPEC §4): enqueue tonight's production summary and send it
// right away. Idempotent (dedupeKey = summary:<tomorrow>). If the send fails,
// /api/cron/outbox retries it.

import { connection } from "next/server";
import { requireCron } from "@/server/cron";
import { prisma } from "@/server/db";
import { sendNotification } from "@/server/outboxSend";
import { enqueueDailySummary } from "@/server/summaryJob";

export async function POST(request: Request): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;
  await connection();
  try {
    const now = new Date();
    const result = await enqueueDailySummary(prisma, now);
    if (result.status !== "enqueued") return Response.json(result);
    // A cron call, not a customer request: awaiting the send is fine. Never throws.
    const send = await sendNotification(prisma, result.notificationId, now);
    return Response.json({ ...result, send });
  } catch (e) {
    console.error("cron summary failed", e);
    return Response.json({ error: "INTERNAL", message: "summary failed" }, { status: 500 });
  }
}
