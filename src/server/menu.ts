// GET /api/menu data (API_SPEC §2). Customer-safe: no grams, limits, usage, batch yield
// or capacity mode ever leaves this module.

import { fieldFor, type FieldColors } from "@/lib/fieldColor";
import type { DbClient } from "./db";

export interface MenuProduct {
  id: string;
  name: string;
  description: string;
  /** The cover: always `images[0] ?? null`. */
  imageUrl: string | null;
  /** Public photo URLs in display order, cover first (0-6). */
  images: string[];
  /** The product's home colours (D95); defaults filled in. */
  field: FieldColors;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  status: "ACTIVE" | "PAUSED";
  leadDays: number;
  /** D115: 0 = Sunday … 6 = Saturday; [] = every day. */
  pickupWeekdays: number[];
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
      fieldColor: true,
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { url: true } },
      unitPriceCents: true,
      bundleSize: true,
      bundlePriceCents: true,
      status: true,
      leadDays: true,
      pickupWeekdays: true,
    },
  });
  const menu: Menu = {
    orderingEnabled: settings.orderingEnabled,
    products: rows.map((p) => {
      // A row whose cover was set without a photos row still shows that cover.
      const images = p.images.length > 0 ? p.images.map((i) => i.url) : p.imageUrl ? [p.imageUrl] : [];
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: images[0] ?? null,
        images,
        field: fieldFor(p.fieldColor),
        unitPriceCents: p.unitPriceCents,
        bundleSize: p.bundleSize,
        bundlePriceCents: p.bundlePriceCents,
        status: p.status === "PAUSED" ? ("PAUSED" as const) : ("ACTIVE" as const),
        leadDays: p.leadDays,
        pickupWeekdays: p.pickupWeekdays,
      };
    }),
    pickupNote: settings.pickupNote,
    deliveryFeeCents: settings.deliveryFeeCents,
    freeDeliveryMinCents: settings.freeDeliveryMinCents,
    maxQtyPerItem: settings.maxQtyPerItem,
  };
  if (settings.showWechatOnHome && settings.ownerWechatId) menu.ownerWechatId = settings.ownerWechatId;
  return menu;
}
