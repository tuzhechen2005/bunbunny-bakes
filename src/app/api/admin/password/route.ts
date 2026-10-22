// POST /api/admin/password { currentPassword, newPassword } (settings page).
// The current session stays logged in; every other session is removed.

import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { changePassword, MAX_PASSWORD_LENGTH } from "@/server/auth";
import { prisma } from "@/server/db";
import { parseJsonBody } from "@/server/session";

const Body = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  // Length rules (and their message) live in changePassword().
  newPassword: z.string().max(1000),
});

export const POST = adminHandler(async ({ request, admin, now }) => {
  const body = await parseJsonBody(request, Body);
  await changePassword(prisma, {
    userId: admin.userId,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    keepSessionTokenHash: admin.tokenHash,
    now,
  });
  return Response.json({ ok: true });
});
