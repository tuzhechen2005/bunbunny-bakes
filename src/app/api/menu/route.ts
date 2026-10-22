// GET /api/menu (API_SPEC §2). Public, read-only.

import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { getMenu } from "@/server/menu";

export async function GET(): Promise<Response> {
  try {
    await connection(); // never frozen at build time
    return NextResponse.json(await getMenu(prisma));
  } catch (e) {
    return jsonError(e);
  }
}
