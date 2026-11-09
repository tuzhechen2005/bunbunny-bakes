import { adminHandler } from '@/server/adminRoute';
import { prisma } from '@/server/db';
import { listPools, decidePool } from '@/server/groupStock';
export const GET = adminHandler(async ({ request, now }) => Response.json({ pools: await listPools(prisma, Object.fromEntries(new URL(request.url).searchParams), now) }));
export const POST = adminHandler(async ({ request, now }) => Response.json({ pool: await decidePool(prisma, await request.json().catch(() => null), now) }));
