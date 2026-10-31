// GET /api/game/grab/leaderboard (G2, D145) (API_SPEC "Game"). Public. Only masked WeChat ids ever leave the server.
// `myBest` is included when the caller passes its own id as ?wechatId= or the x-game-wechat header.

import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getGrabLeaderboard } from "@/server/grab";
import { jsonError, noStore } from "@/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    await connection();
    const url = new URL(request.url);
    const mine = url.searchParams.get("wechatId") ?? request.headers.get("x-game-wechat");
    const board = await getGrabLeaderboard(prisma, new Date(), mine);
    return noStore(NextResponse.json(board));
  } catch (e) {
    return jsonError(e);
  }
}
