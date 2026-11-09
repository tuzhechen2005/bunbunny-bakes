import { adminHandler } from '@/server/adminRoute';
import { prisma } from '@/server/db';
import { updateStock } from '@/server/groupStock';
export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => Response.json({ lot: await updateStock(prisma, params.id, await request.json().catch(() => null), now) }));
export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => Response.json({ lot: await updateStock(prisma, params.id, { closed: true }, now) }));
