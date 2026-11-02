import { z } from "zod";
import type { DbClient } from "./db";
import { parseGameInput, rateLimit, startSchema } from "./game";
import { normalizeWechat, purchase, shopView } from "./economy";

const identitySchema = startSchema.pick({ wechatId: true });
const buySchema = identitySchema.extend({ item: z.enum(["bomb", "bell", "slide"]), qty: z.number().int().min(1).max(100) });
export const SHOP_READ_LIMIT = 120;
export const SHOP_BUY_LIMIT = 30;

/** Independent IP and normalized identity buckets, using the game's atomic hourly limiter. */
export async function readShop(db: DbClient, input: unknown, ipHash: string, now: Date) {
  await rateLimit(db, `shop_read_ip:${ipHash}`, SHOP_READ_LIMIT, now);
  const { wechatId } = parseGameInput(identitySchema, input);
  await rateLimit(db, `shop_read_wechat:${normalizeWechat(wechatId)}`, SHOP_READ_LIMIT, now);
  return db.$transaction(tx => shopView(tx, wechatId, now));
}

export async function buyShop(db: DbClient, input: unknown, ipHash: string, now: Date) {
  await rateLimit(db, `shop_buy_ip:${ipHash}`, SHOP_BUY_LIMIT, now);
  const { wechatId, item, qty } = parseGameInput(buySchema, input);
  await rateLimit(db, `shop_buy_wechat:${normalizeWechat(wechatId)}`, SHOP_BUY_LIMIT, now);
  return db.$transaction(tx => purchase(tx, wechatId, item, qty, now));
}
