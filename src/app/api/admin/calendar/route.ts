import { adminHandler, parseQuery } from "@/server/adminRoute";
import { calendarQuerySchema, loadCalendar } from "@/server/calendar";
import { prisma } from "@/server/db";

// Production totals are owner-only; keep this behind the same admin session guard.
export const GET = adminHandler(async ({ request }) => {
  const { from, to } = parseQuery(request, calendarQuerySchema);
  const result = await prisma.$transaction((tx) => loadCalendar(tx, from, to));
  return Response.json(result);
});
