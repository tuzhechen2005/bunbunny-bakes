// POST /api/game/grab/finish (G2, D145) (API_SPEC "Game"). Public, rate limited per IP hash. The server replays the launch log.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { finishGrabRun, GRAB_MAX_FINISH_BODY_BYTES } from "@/server/grab";
import { gameIpHash, readGameJson } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readGameJson(request, GRAB_MAX_FINISH_BODY_BYTES);
    const ipHash = gameIpHash(request);
    if (!ipHash) return NextResponse.json({ error: "INTERNAL", message: copy.errors.fallback }, { status: 500 });
    await connection();
    const result = await finishGrabRun(prisma, body, ipHash, new Date());
    return noStore(NextResponse.json(result));
  } catch (e) {
    return jsonError(e);
  }
}
