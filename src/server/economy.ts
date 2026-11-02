import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { gameCoins, orderCoins, SHOP_CATALOG, type ShopItem } from "@/domain/economy";
import { localDateOf } from "@/domain/dates";
import type { DbClient, Tx } from "./db";
import { writeAudit } from "./audit";
import { AppError } from "./errors";

export const normalizeWechat = (id: string) => id.trim().toLowerCase();
/** Transaction-scoped, namespaced lock. Hash collisions only serialize unrelated wallets. */
export async function lockWallet(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`coins:${normalizeWechat(id)}`}, 0))`;
}
export async function balance(tx: Tx, id: string) {
  return (await tx.coinLedger.aggregate({ where: { wechatIdNorm: normalizeWechat(id) }, _sum: { delta: true } }))._sum.delta ?? 0;
}
export async function inventory(db: Pick<Tx, "inventory">, id: string) {
  const rows = await db.inventory.findMany({ where: { wechatIdNorm: normalizeWechat(id) } });
  return Object.fromEntries(SHOP_CATALOG.map(({ item }) => [item, rows.find(r => r.item === item)?.count ?? 0])) as Record<ShopItem, number>;
}

/** Called only after replay succeeds. Finish claim, inventory and coins commit together. */
export async function claimCoinFinish(db: DbClient, args: { where: { id: string; finishedAt: null }; data: Prisma.GameRunUpdateManyMutationInput }, now: Date,
  uses: Partial<Record<ShopItem, number>> = {}, distance?: number) {
  return db.$transaction(async tx => {
    const head = await tx.gameRun.findFirstOrThrow({ where: { id: args.where.id } });
    await lockWallet(tx, head.wechatId);
    const claimed = await tx.gameRun.updateMany(args);
    if (!claimed.count) return claimed;
    const run = await tx.gameRun.findUniqueOrThrow({ where: { id: head.id } });
    for (const { item } of SHOP_CATALOG) {
      const count = uses[item] ?? 0;
      if (!Number.isInteger(count) || count < 0) throw new AppError("VALIDATION");
      if (count && (await tx.inventory.updateMany({
        where: { wechatIdNorm: normalizeWechat(run.wechatId), item, count: { gte: count } },
        data: { count: { decrement: count } },
      })).count !== 1) throw new AppError("VALIDATION");
    }
    const banned = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM "GameBan" WHERE lower(btrim("wechatId")) = ${normalizeWechat(run.wechatId)}`;
    if (!run.hidden && !run.suspicious && !banned[0].n) {
      const daily = await tx.$queryRaw<{ total: number }[]>`SELECT COALESCE(sum(delta), 0)::int total FROM "CoinLedger"
        WHERE "wechatIdNorm" = ${normalizeWechat(run.wechatId)} AND reason = 'GAME_RUN'
        AND ("createdAt" AT TIME ZONE 'America/Chicago')::date = ${localDateOf(now)}::date`;
      const delta = Math.min(Math.max(0, 300 - daily[0].total), gameCoins(run.game, distance ?? run.score ?? 0, run.level ?? 1, run.passedAt !== null));
      await tx.coinLedger.create({ data: { wechatIdNorm: normalizeWechat(run.wechatId), delta, reason: "GAME_RUN", refId: run.id, createdAt: now } });
    }
    return claimed;
  }, { timeout: 20000, maxWait: 20000 });
}

/** Existing order/date locks are already held. Corrections append compensating rows.
 * The first award uses the order id; later transitions use the locked version token.
 */
export async function syncOrderCoins(tx: Tx, order: { id: string; wechatId: string; status: string; subtotalCents: number; updatedAt: Date }, to: string, now: Date) {
  if (order.status === to || (order.status !== "COMPLETED" && to !== "COMPLETED")) return;
  const original = await tx.coinLedger.findUnique({ where: { reason_refId: { reason: "ORDER", refId: order.id } } });
  const id = original?.wechatIdNorm ?? normalizeWechat(order.wechatId);
  await lockWallet(tx, id);
  const rows = await tx.coinLedger.findMany({ where: { reason: "ORDER", OR: [{ refId: order.id }, { refId: { startsWith: `${order.id}:` } }] } });
  const net = rows.reduce((sum, row) => sum + row.delta, 0);
  const target = to === "COMPLETED" ? (original?.delta ?? orderCoins(order.subtotalCents)) : 0;
  if (target === net) return;
  await tx.coinLedger.create({ data: { wechatIdNorm: id, delta: target - net, reason: "ORDER", refId: original ? `${order.id}:${order.updatedAt.toISOString()}` : order.id, createdAt: now } });
}

export async function purchase(tx: Tx, id: string, item: ShopItem, qty: number, now = new Date()) {
  const wechatIdNorm = normalizeWechat(id);
  const product = SHOP_CATALOG.find(p => p.item === item);
  if (!product || !Number.isInteger(qty) || qty < 1 || qty > 100) throw new AppError("VALIDATION");
  await lockWallet(tx, id);
  const cost = product.price * qty;
  if (await balance(tx, id) < cost) throw new AppError("VALIDATION");
  const purchaseId = randomUUID();
  await tx.coinLedger.create({ data: { wechatIdNorm, delta: -cost, reason: "PURCHASE", refId: purchaseId, createdAt: now } });
  await tx.inventory.upsert({ where: { wechatIdNorm_item: { wechatIdNorm, item } }, create: { wechatIdNorm, item, count: qty }, update: { count: { increment: qty } } });
  await writeAudit(tx, { actor: "CUSTOMER", action: "shop.purchase", entityType: "CoinLedger", entityId: purchaseId, after: { wechatIdNorm, item, qty, cost }, at: now });
  return { balance: await balance(tx, id), inventory: await inventory(tx, id), catalog: SHOP_CATALOG };
}

/** Identity is self-reported, as in the games (D170); no ownership verification. Only balance, inventory and catalog may leave this projection; no per-order details. */
export async function shopView(tx: Tx, id: string) {
  await lockWallet(tx, id);
  return {
    balance: await balance(tx, id), inventory: await inventory(tx, id), catalog: SHOP_CATALOG,
  };
}
