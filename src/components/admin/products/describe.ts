import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { CapacityMode, ProductStatus } from "@/domain/types";

const t = copy.admin.products;

export interface ProductImageDto {
  id: string;
  url: string;
  sortOrder: number;
}

/** The product as the admin API returns it (dates arrive as ISO strings). */
export interface ProductDto {
  id: string;
  name: string;
  description: string;
  /** The cover (images[0]). */
  imageUrl: string | null;
  images: ProductImageDto[];
  /** `#RRGGBB`, null = default 奶白. */
  fieldColor: string | null;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  capacityMode: CapacityMode;
  doughG: number | null;
  roundG: number | null;
  piecesPerRound: number | null;
  dailyLimit: number | null;
  batchYield: number | null;
  leadDays: number;
  /** D115: 0 = Sunday … 6 = Saturday; [] = every day. */
  pickupWeekdays: number[];
  status: ProductStatus;
  sortOrder: number;
}

export interface OverLimitDateDto {
  date: string;
  kinds: string[];
}

function fill(template: string, values: Record<string, string | number | null>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

/** 「按个算面团 70 g」「按大圆包 340 g ÷ 4」「独立限额 每天 24」 */
export function modeLabel(p: ProductDto): string {
  switch (p.capacityMode) {
    case "DOUGH_PER_UNIT":
      return fill(t.modeUnit, { g: p.doughG });
    case "DOUGH_PER_ROUND":
      return fill(t.modeRound, { round: p.roundG, pieces: p.piecesPerRound });
    case "INDEPENDENT":
      return fill(t.modeIndependent, { limit: p.dailyLimit });
  }
}

/** 「单价 $2.49 · 4 个 $8.99」 */
export function priceLine(p: ProductDto): string {
  const unit = fill(t.unitPrice, { price: formatCents(p.unitPriceCents) });
  const bundle =
    p.bundlePriceCents === null
      ? t.noBundle
      : fill(t.bundleLine, { size: p.bundleSize, price: formatCents(p.bundlePriceCents) });
  return `${unit} · ${bundle}`;
}

export function statusLabel(status: ProductStatus): string {
  return { ACTIVE: t.statusActive, PAUSED: t.statusPaused, ARCHIVED: t.statusArchived }[status];
}

/** 「10/30」 from "2026-10-30" (no zero padding). */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export { fill };
