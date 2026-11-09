import { adminHandler } from '@/server/adminRoute';
import { prisma } from '@/server/db';
import { createStock } from '@/server/groupStock';
export const POST = adminHandler(async ({ request, now }) => Response.json({ lot: await createStock(prisma, await request.json().catch(() => null), now, true) }, { status: 201 }));
