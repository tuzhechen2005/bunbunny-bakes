import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { M3_MAX_FINISH_BODY_BYTES } from "@/server/m3";
import { progressRun } from "@/server/gameProgress";
import { readGameJson } from "@/server/gameRoute";
import { liveScoresEnabled } from "@/server/liveScores";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  if (!liveScoresEnabled()) return noStore(new Response(null, { status: 404 }));
  try {
    const body = await readGameJson(request, M3_MAX_FINISH_BODY_BYTES);
    await connection();
    return noStore(NextResponse.json(await progressRun(prisma, "M3", body, new Date())));
  } catch (e) { return jsonError(e); }
}
