// Data for the admin order forms (GET /api/admin/order-form): products the owner can
// pick and open dates (today .. today+60) with their usage. Read-only.

import { usage } from "@/domain/capacity";
import { addDays, dayLabel, localDateOf } from "@/domain/dates";
import { isOccupying } from "@/domain/status";
import type { CapacityMode, LocalDate, ProductStatus } from "@/domain/types";
import { loadDayContext, loadProductMap, loadSettings } from "./day";
import type { DbClient } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";

export const FORM_HORIZON_DAYS = 60;

export interface FormProduct {
  id: string;
  name: string;
  status: ProductStatus;
  unitPriceCents: number;
  bundleSize: number;
  bundlePriceCents: number | null;
  capacityMode: CapacityMode;
}

export interface FormDate {
  date: LocalDate;
  label: string;
  isOpen: boolean;
  deliveryEnabled: boolean;
  doughG: number;
  doughLimitG: number;
  deliveries: number;
  deliveryLimit: number;
}

export interface OrderFormData {
  products: FormProduct[];
  dates: FormDate[];
  fees: { deliveryFeeCents: number; freeDeliveryMinCents: number };
}

export async function loadOrderFormData(db: DbClient, now: Date): Promise<OrderFormData> {
  const today = localDateOf(now);
  const last = addDays(today, FORM_HORIZON_DAYS);
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx);
    const productMap = await loadProductMap(tx);
    const rows = await tx.openDate.findMany({
      where: { isOpen: true, date: { gte: toDbDate(today), lte: toDbDate(last) } },
      orderBy: { date: "asc" },
    });
    const dates: FormDate[] = [];
    for (const r of rows) {
      const date = fromDbDate(r.date);
      const ctx = await loadDayContext(tx, date, settings, productMap);
      const occupying = ctx.orders.filter((o) => isOccupying(o.status));
      const u = usage(occupying, productMap);
      dates.push({
        date,
        label: dayLabel(date),
        isOpen: true,
        deliveryEnabled: ctx.limits.deliveryEnabled,
        doughG: u.doughG,
        doughLimitG: ctx.limits.doughLimitG,
        deliveries: u.deliveries,
        deliveryLimit: ctx.limits.deliveryLimit,
      });
    }
    const products: FormProduct[] = Object.values(productMap)
      .filter((p) => p.status !== "ARCHIVED")
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        unitPriceCents: p.unitPriceCents,
        bundleSize: p.bundleSize,
        bundlePriceCents: p.bundlePriceCents,
        capacityMode: p.capacityMode,
      }));
    return {
      products,
      dates,
      fees: {
        deliveryFeeCents: settings.deliveryFeeCents,
        freeDeliveryMinCents: settings.freeDeliveryMinCents,
      },
    };
  });
}
