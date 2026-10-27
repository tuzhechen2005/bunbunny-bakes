// POST /api/cron/game-winner (API_SPEC §4, D114): Mondays 09:00 America/Chicago, enqueue last
// week's game winner email and send it right away. Idempotent (dedupeKey = game_winner:<weekKey>).
// If the send fails, /api/cron/outbox retries it.

import { connection } from "next/server";
import { requireCron } from "@/server/cron";
import { prisma } from "@/server/db";
import { enqueueGameWinner } from "@/server/gameWinner";
import { sendNotification } from "@/server/outboxSend";

export async function POST(request: Request): Promise<Response> {
  const denied = requireCron(request);
  if (denied) return denied;
  await connection();
  try {
    const now = new Date();
    const result = await enqueueGameWinner(prisma, now);
    if (result.status !== "enqueued") return Response.json(result);
    // A cron call, not a customer request: awaiting the send is fine. Never throws.
    const send = await sendNotification(prisma, result.notificationId, now);
    return Response.json({ ...result, send });
  } catch (e) {
    console.error("cron game-winner failed", e);
    return Response.json({ error: "INTERNAL", message: "game winner failed" }, { status: 500 });
  }
}
