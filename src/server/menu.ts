// GET /api/menu data (API_SPEC §2). Customer-safe: no grams, limits, usage, batch yield
// or capacity mode ever leaves this module.

import type { DbClient } from "./db";

export interface MenuProduct {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  status: "ACTIVE" | "PAUSED";
  leadDays: number;
}

export interface Menu {
  orderingEnabled: boolean;
  products: MenuProduct[];
  pickupNote: string;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number;
  maxQtyPerItem: number;
  /** Only present when the owner chose to show it on the home page (D44). */
  ownerWechatId?: string;
}

export async function getMenu(db: DbClient): Promise<Menu> {
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("Setting row (id = 1) is missing; run `npm run db:seed`");
  const rows = await db.product.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      unitPriceCents: true,
      bundleSize: true,
      bundlePriceCents: true,
      status: true,
      leadDays: true,
    },
  });
  const menu: Menu = {
    orderingEnabled: settings.orderingEnabled,
    products: rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl,
      unitPriceCents: p.unitPriceCents,
      bundleSize: p.bundleSize,
      bundlePriceCents: p.bundlePriceCents,
      status: p.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      leadDays: p.leadDays,
    })),
    pickupNote: settings.pickupNote,
    deliveryFeeCents: settings.deliveryFeeCents,
    freeDeliveryMinCents: settings.freeDeliveryMinCents,
    maxQtyPerItem: settings.maxQtyPerItem,
  };
  if (settings.showWechatOnHome && settings.ownerWechatId) menu.ownerWechatId = settings.ownerWechatId;
  return menu;
}
