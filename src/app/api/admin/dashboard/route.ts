// GET /api/admin/dashboard (API_SPEC §3).

import { adminHandler } from "@/server/adminRoute";
import { loadDashboard } from "@/server/dashboard";
import { prisma } from "@/server/db";

export const GET = adminHandler(async ({ now }) => Response.json(await loadDashboard(prisma, now)));
