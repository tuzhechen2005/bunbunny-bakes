import { connection } from 'next/server';
import { prisma } from '@/server/db';
import { listStock } from '@/server/groupStock';
import { addDays, localDateOf } from '@/domain/dates';
import { jsonError } from '@/server/http';
export async function GET() {
  try {
    await connection();
    const now = new Date();
    const from = localDateOf(now);
    const lots = await prisma.$transaction(tx => listStock(tx, { from, to: addDays(from, 60) }, now), { isolationLevel: 'RepeatableRead' });
    return Response.json({ lots }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return jsonError(e); }
}
