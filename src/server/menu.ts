// GET /api/menu data (API_SPEC §2). Public projections exclude internal fields.
// MenuData is server-only cache data; always use presentMenu before returning it.

import { presentNewProducts } from "@/domain/newProducts";
import { fieldFor, type FieldColors } from "@/lib/fieldColor";
import type { DbClient } from "./db";

export interface MenuProduct {
  saleMode?: "NORMAL" | "GROUP";
  groupMin?: number | null;
  batchYield?: number | null;
  isNew: boolean;
  id: string;
  name: string;
  description: string;
  /** The cover: always `images[0] ?? null`. */
  imageUrl: string | null;
  /** Public photo URLs in display order, cover first (0-6). */
  images: string[];
  /** The product's home colours (D95); defaults filled in. */
  field: FieldColors;
  flavors: { pickupWeekdays?: number[]; id: string; name: string; priceCents: number; bundlePriceCents: number | null }[];
  priceFromCents: number;
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

/** Internal cache payload; must be projected before crossing a customer boundary. */
export type MenuData = Omit<Menu, "products"> & {
  products: (Omit<MenuProduct, "isNew"> & { newUntil: Date | null })[];
};

export function presentMenu(data: MenuData, now: Date): Menu {
  return { ...data, products: presentNewProducts(data.products, now) };
}

export async function getMenu(db: DbClient, now: Date = new Date()): Promise<Menu> {
  return presentMenu(await getMenuData(db), now);
}

export async function getMenuData(db: DbClient): Promise<MenuData> {
  const settings = await db.setting.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("Setting row (id = 1) is missing; run `npm run db:seed`");
  const rows = await db.product.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      saleMode: true, groupMin: true, batchYield: true,
      newUntil: true,
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      fieldColor: true,
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { url: true } },
      flavors: { where: { active: true }, orderBy: [{ sort: "asc" }, { id: "asc" }], select: { id: true, name: true, priceCents: true, bundlePriceCents: true, pickupWeekdays: true } },
      unitPriceCents: true,
      bundleSize: true,
      bundlePriceCents: true,
      status: true,
      leadDays: true,
      pickupWeekdays: true,
    },
  });
  const menu: MenuData = {
    orderingEnabled: settings.orderingEnabled,
    products: rows.map((p) => {
      // A row whose cover was set without a photos row still shows that cover.
      const images = p.images.length > 0 ? p.images.map((i) => i.url) : p.imageUrl ? [p.imageUrl] : [];
      return {
        ...(p.saleMode === "GROUP" ? { saleMode: p.saleMode, groupMin: p.groupMin, batchYield: p.batchYield } : {}),
        newUntil: p.newUntil,
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: images[0] ?? null,
        images,
        field: fieldFor(p.fieldColor),
        flavors: p.flavors.map(({pickupWeekdays,...f})=>({...f,...(pickupWeekdays.length ? {pickupWeekdays}: {})})),
        priceFromCents: p.flavors.length ? Math.min(...p.flavors.map(f => f.priceCents)) : p.unitPriceCents,
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
