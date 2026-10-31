import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { TD_MAX_FINISH_BODY_BYTES } from "@/server/td";
import { progressRun } from "@/server/gameProgress";
import { readGameJson } from "@/server/gameRoute";
import { liveScoresEnabled } from "@/server/liveScores";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  if (!liveScoresEnabled()) return noStore(new Response(null, { status: 404 }));
  try {
    const body = await readGameJson(request, TD_MAX_FINISH_BODY_BYTES);
    await connection();
    return noStore(NextResponse.json(await progressRun(prisma, "TD", body, new Date())));
  } catch (e) { return jsonError(e); }
}
