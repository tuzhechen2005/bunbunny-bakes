import { adminHandler } from "@/server/adminRoute";
import { updateOpenDate } from "@/server/calendar";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export const PUT = adminHandler<{ date: string }>(async ({ request, params, now }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
  return Response.json(await updateOpenDate(prisma, params.date, body, now));
});
