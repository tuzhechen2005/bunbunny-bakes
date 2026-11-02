import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { readShop } from "@/server/shop";
import { gameIpHash } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const ipHash = gameIpHash(request);
    if (!ipHash) throw new Error("Missing IP hash secret");
    await connection();
    const body = { wechatId: new URL(request.url).searchParams.get("wechatId") };
    return noStore(NextResponse.json(await readShop(prisma, body, ipHash, new Date())));
  } catch (error) {
    return noStore(jsonError(error));
  }
}
