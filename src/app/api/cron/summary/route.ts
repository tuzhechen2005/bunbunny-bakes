// POST /api/cron/summary (API_SPEC §4): enqueue tonight's production summary. Idempotent
// (dedupeKey = summary:<tomorrow>). Sending happens in /api/cron/outbox.

import { connection } from "next/server";
import { requireCron } from "@/server/cron";
import { prisma } from "@/server/db";
import { enqueueDailySummary } from "@/server/summaryJob";

export async function POST(request: Request): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;
  await connection();
  try {
    return Response.json(await enqueueDailySummary(prisma, new Date()));
  } catch (e) {
    console.error("cron summary failed", e);
    return Response.json({ error: "INTERNAL", message: "summary failed" }, { status: 500 });
  }
}
