// POST /api/game/tu/start (C6, D124) (API_SPEC "Game"). Public, rate limited per IP hash.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { startTuRun } from "@/server/tu";
import { gameIpHash, readGameJson } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readGameJson(request, 4096);
    const ipHash = gameIpHash(request);
    if (!ipHash) return NextResponse.json({ error: "INTERNAL", message: copy.errors.fallback }, { status: 500 });
    await connection();
    const result = await startTuRun(prisma, body, ipHash, new Date());
    return noStore(NextResponse.json(result, { status: 201 }));
  } catch (e) {
    return jsonError(e);
  }
}
