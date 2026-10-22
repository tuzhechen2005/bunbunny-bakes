// GET/PUT /api/admin/settings (API_SPEC §3).

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { getSettingsView, parseSettingsUpdate, updateSettings } from "@/server/settings";

export const GET = adminHandler(async () => Response.json(await getSettingsView(prisma)));

export const PUT = adminHandler(async ({ request, now }) => {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
  return Response.json(await updateSettings(prisma, parseSettingsUpdate(json), now));
});
