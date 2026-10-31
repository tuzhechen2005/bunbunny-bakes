// GET /api/game/td/leaderboard (S2, D135) (API_SPEC "Game"). Public. Only masked WeChat ids ever leave the server.
// `myBest` is included when the caller passes its own id as ?wechatId= or the x-game-wechat header.

import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getTdLeaderboard } from "@/server/td";
import { jsonError, noStore } from "@/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    await connection();
    const url = new URL(request.url);
    const mine = url.searchParams.get("wechatId") ?? request.headers.get("x-game-wechat");
    const board = await getTdLeaderboard(prisma, new Date(), mine);
    return noStore(NextResponse.json(board));
  } catch (e) {
    return jsonError(e);
  }
}
