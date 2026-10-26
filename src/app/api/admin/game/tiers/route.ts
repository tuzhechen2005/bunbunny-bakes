import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { addGamePiece, addTier, getTiers, initTiers } from "@/server/gameAdmin";

export const GET = adminHandler(async () => Response.json(await getTiers(prisma)));

const body = z.object({ productId: z.string().max(64).optional() });

/** `{}` saves the defaults, `{ productId }` adds a product tier, `{ name, fieldColor }` a game-only piece (D107). */
export const POST = adminHandler(async ({ request, now }) => {
  const raw = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && ("name" in raw || "fieldColor" in raw)) {
    await addGamePiece(prisma, raw, now);
  } else {
    const { productId } = body.parse(raw);
    if (productId === undefined) await initTiers(prisma, now);
    else await addTier(prisma, productId, now);
  }
  return Response.json(await getTiers(prisma), { status: 201 });
});
