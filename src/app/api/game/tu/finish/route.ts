// POST /api/game/tu/finish (C6, D124) (API_SPEC "Game"). Public, rate limited per IP hash. The server replays the tap log.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { finishTuRun, TU_MAX_FINISH_BODY_BYTES } from "@/server/tu";
import { gameIpHash, readGameJson } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readGameJson(request, TU_MAX_FINISH_BODY_BYTES);
    const ipHash = gameIpHash(request);
    if (!ipHash) return NextResponse.json({ error: "INTERNAL", message: copy.errors.fallback }, { status: 500 });
    await connection();
    const result = await finishTuRun(prisma, body, ipHash, new Date());
    return noStore(NextResponse.json(result));
  } catch (e) {
    return jsonError(e);
  }
}
