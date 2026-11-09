import { allowsDate } from "@/domain/weekdays";
import { connection } from 'next/server';
import { prisma } from '@/server/db';
import { listPools } from '@/server/groupStock';
import { addDays, localDateOf } from '@/domain/dates';
import { jsonError } from '@/server/http';
/** Public next-open-date progress; never includes order counts, decisions or notes. */
export async function GET(request: Request) {
  try {
    await connection();
    const now = new Date();
    const from = localDateOf(now);
    const productId = new URL(request.url).searchParams.get('productId') ?? undefined;
    const pools = await prisma.$transaction(async tx => {
      const open = await tx.openDate.findMany({ where: { isOpen: true }, select: { date: true } });
      const products = await tx.product.findMany({ where: { saleMode: "GROUP", status: "ACTIVE" }, include: { flavors: true } });
      const dates = new Set(open.map(d => d.date.toISOString().slice(0, 10)));
      return (await listPools(tx, { from, to: addDays(from, 60), productId }, now)).filter(p => {
        const product = products.find(x => x.id === p.productId);
        const flavor = product?.flavors.find(f => f.id === p.flavorId);
        return dates.has(p.date) && product && allowsDate(product, p.date) && (!p.flavorId || (flavor?.active && allowsDate(flavor, p.date)));
      }).map(({ date, productId, flavorId, pieces, min, cakes, fullCakes, last, spare, status, needMore }) => ({ date, productId, flavorId, pieces, min, cakes, fullCakes, last, spare, status, needMore }));
    }, { isolationLevel: 'RepeatableRead' });
    return Response.json({ pools }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return jsonError(e); }
}
