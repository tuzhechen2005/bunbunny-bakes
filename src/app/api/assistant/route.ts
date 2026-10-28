// POST /api/assistant (C3, API_SPEC "小小🐰"). Public; same-origin + JSON only.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { askAssistant, assistantIpHash, parseAssistantBody } from "@/server/assistant";
import { prisma } from "@/server/db";
import { isAppError } from "@/server/errors";
import { readGameJson } from "@/server/gameRoute";
import { jsonError, noStore } from "@/server/http";
import { checkOrigin } from "@/server/origin";

/** 12 messages × 500 characters × up to 4 UTF-8 bytes, plus the cart. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  // The time budget (BUDGET_MS) counts from here, DB reads included.
  const arrivedAt = new Date();
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  try {
    const body = parseAssistantBody(await readGameJson(request, MAX_BODY_BYTES));
    await connection();
    const outcome = await askAssistant(prisma, body, assistantIpHash(request), arrivedAt);
    return noStore(NextResponse.json(outcome.body, { status: outcome.status }));
  } catch (e) {
    // C3: a bad request body is 400 here (other customer APIs use 422).
    if (isAppError(e) && e.code === "VALIDATION") {
      return NextResponse.json(
        { error: "VALIDATION", message: copy.errors.VALIDATION, fields: e.extra?.fields ?? {} },
        { status: 400 },
      );
    }
    return jsonError(e);
  }
}
