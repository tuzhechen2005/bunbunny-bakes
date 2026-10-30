import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getGameHub } from "@/server/gameHub";
import { jsonError, noStore } from "@/server/http";

export async function GET(): Promise<Response> {
  try {
    await connection();
    return noStore(NextResponse.json(await getGameHub(prisma, new Date())));
  } catch (e) {
    return jsonError(e);
  }
}
