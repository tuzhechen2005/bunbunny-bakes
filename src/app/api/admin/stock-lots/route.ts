import { adminHandler } from '@/server/adminRoute';
import { prisma } from '@/server/db';
import { listStock, createStock } from '@/server/groupStock';
export const GET = adminHandler(async ({ request, now }) => Response.json({ lots: await listStock(prisma, Object.fromEntries(new URL(request.url).searchParams), now, true) }));
export const POST = adminHandler(async ({ request, now }) => Response.json({ lot: await createStock(prisma, await request.json().catch(() => null), now) }, { status: 201 }));
