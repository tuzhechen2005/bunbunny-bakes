// The tier configuration a new run snapshots at start (D101-D103).
//
// Owner-configured GameTier rows win; with fewer than 2 product tiers configured the default is
// the active products in menu order (up to 5) using each product's cover photo, plus the 大面包.

import { BIG_RADIUS, defaultPoints, defaultRadius, type TierDef } from "@/lib/game";
import { fieldFor } from "@/lib/field";
import type { DbClient } from "./db";

export const BIG_IMAGE_URL = "/brand/logo.webp";
export const MAX_PRODUCT_TIERS = 5;
const BIG_COLOR = { bg: "#EFE7DA", ink: "#4A2723" };

export interface GameTierConfig extends TierDef {
  imageUrl: string | null;
  color: { bg: string; ink: string };
}

/**
 * Colour of product tier `index`. Today the home cycle (src/lib/field.ts); once products carry
 * their own colour (K1 `Product.fieldColor`), this is the one place to switch to it.
 */
export function tierColor(index: number): { bg: string; ink: string } {
  const f = fieldFor(index);
  return { bg: f.field, ink: f.ink };
}

function build(items: { id: string; imageUrl: string | null }[], bigImageUrl: string | null): GameTierConfig[] {
  const n = items.length;
  const tiers: GameTierConfig[] = items.map((it, i) => ({
    id: it.id,
    radius: defaultRadius(i, n),
    points: defaultPoints(i),
    imageUrl: it.imageUrl,
    color: tierColor(i),
  }));
  tiers.push({ id: "big", radius: BIG_RADIUS, points: defaultPoints(n), imageUrl: bigImageUrl || BIG_IMAGE_URL, color: BIG_COLOR });
  return tiers;
}

export async function loadTierConfigs(db: DbClient): Promise<GameTierConfig[]> {
  const rows = await db.gameTier.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { product: { select: { imageUrl: true } } },
  });
  const configured = rows.filter((r) => !r.isBig).slice(0, MAX_PRODUCT_TIERS);
  const bigRow = rows.find((r) => r.isBig);
  const bigImage = bigRow?.imageUrl || null;
  if (configured.length >= 2) {
    return build(
      configured.map((r) => ({ id: r.id, imageUrl: r.imageUrl || r.product?.imageUrl || null })),
      bigImage,
    );
  }
  const products = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: MAX_PRODUCT_TIERS,
    select: { id: true, imageUrl: true },
  });
  if (products.length === 0) {
    // A shop with no products still gets a playable (image-less) board.
    return build([{ id: "t0", imageUrl: null }, { id: "t1", imageUrl: null }], bigImage);
  }
  return build(products.map((p) => ({ id: p.id, imageUrl: p.imageUrl || null })), bigImage);
}

/** Reads the tiers snapshot stored on a run; throws when it is not a valid tier list. */
export function tierDefsFromSnapshot(snapshot: unknown): TierDef[] {
  if (!Array.isArray(snapshot) || snapshot.length < 2 || snapshot.length > MAX_PRODUCT_TIERS + 1) {
    throw new Error("bad tiers snapshot");
  }
  return snapshot.map((t) => {
    const o = t as Partial<TierDef> | null;
    if (!o || typeof o.id !== "string" || typeof o.radius !== "number" || typeof o.points !== "number") {
      throw new Error("bad tiers snapshot");
    }
    return { id: o.id, radius: o.radius, points: o.points };
  });
}
