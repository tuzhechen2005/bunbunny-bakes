import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { buyShop } from "@/server/shop";
import { gameIpHash, readGameJson } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  try {
    const ipHash = gameIpHash(request);
    if (!ipHash) throw new Error("Missing IP hash secret");
    await connection();
    const body = await readGameJson(request, 4096);
    return noStore(NextResponse.json(await buyShop(prisma, body, ipHash, new Date())));
  } catch (error) {
    return noStore(jsonError(error));
  }
}
