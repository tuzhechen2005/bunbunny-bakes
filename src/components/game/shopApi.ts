export type ShopItem = "bomb" | "bell" | "slide";
export interface ShopState {
  balance: number;
  inventory: Partial<Record<ShopItem, number>>;
  catalog: { item: ShopItem; price: number }[];
  /** Order awards from the last 7 days (newest first). */
  orderAwards?: { coins: number; at: string }[];
}

export async function fetchShop(wechatId: string): Promise<ShopState> {
  const res = await fetch(`/api/shop?wechatId=${encodeURIComponent(wechatId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<ShopState>;
}

export async function buyItem(wechatId: string, item: ShopItem, qty = 1): Promise<ShopState> {
  const res = await fetch("/api/shop/buy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wechatId, item, qty }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error ?? String(res.status)), { code: body?.error });
  return body as ShopState;
}
