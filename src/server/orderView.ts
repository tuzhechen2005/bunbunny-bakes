// GET /api/o/{token} data (API_SPEC §2, DATA_MODEL §2 "顾客看到的状态").
// Exactly the fields the order page needs: no ids, no wechatId, no payment fields,
// no raw timestamps, no internal status enum beyond `statusKind`.

import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import { cutoffLabel } from "@/domain/cutoff";
import { customerCanCancel, customerStatusText } from "@/domain/status";
import type { OrderStatus } from "@/domain/types";
import type { DbClient } from "./db";
import { fromDbDate } from "./dbDates";
import { AppError } from "./errors";
import { isWellFormedViewToken } from "./http";

export type StatusKind = "PENDING" | "CONFIRMED" | "BAKING" | "READY" | "COMPLETED" | "CANCELLED";

export interface CustomerOrderView {
  orderNo: string;
  /** `imageUrl`: the public product photo (null: none, or the product is gone). */
  items: { name: string; qty: number; lineTotalCents: number; imageUrl: string | null }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  pickupDate: string;
  pickupDateLabel: string;
  fulfillment: "PICKUP" | "DELIVERY";
  statusText: string;
  statusKind: StatusKind;
  ownerWechatId: string;
  pickupNote: string | null;
  canCancel: boolean;
  cancelDeadlineLabel: string | null;
  note: string | null;
}

export function statusKindOf(status: OrderStatus): StatusKind {
  switch (status) {
    case "NEW":
    case "CONTACTED":
      return "PENDING";
    case "CONFIRMED":
    case "BAKING":
    case "READY":
    case "COMPLETED":
      return status;
    case "CANCELLED":
    case "REJECTED":
      return "CANCELLED";
  }
}

/** "10/29 周四 20:00 截止" -> "10/29 周四 20:00" (the template adds its own wording). */
function deadlineWithoutSuffix(cutoffAt: Date): string {
  return cutoffLabel(cutoffAt).replace(/\s*截止$/, "");
}

/** Unknown and malformed tokens both throw the same NOT_FOUND. */
export async function getCustomerOrderView(
  db: DbClient,
  token: string,
  now: Date,
): Promise<CustomerOrderView> {
  if (!isWellFormedViewToken(token)) throw new AppError("NOT_FOUND");
  const order = await db.order.findUnique({
    where: { viewToken: token },
    select: {
      orderNo: true,
      status: true,
      fulfillment: true,
      pickupDate: true,
      subtotalCents: true,
      deliveryFeeCents: true,
      totalCents: true,
      note: true,
      cutoffAt: true,
      items: {
        orderBy: { id: "asc" },
        select: { productId: true, nameSnapshot: true, qty: true, lineTotalCents: true },
      },
    },
  });
  if (!order) throw new AppError("NOT_FOUND");

  const settings = await db.setting.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("Setting row (id = 1) is missing; run `npm run db:seed`");
  const products = await db.product.findMany({
    where: { id: { in: order.items.map((i) => i.productId) } },
    select: { id: true, capacityMode: true, sortOrder: true, imageUrl: true },
  });
  const mode = new Map(products.map((p) => [p.id, p.capacityMode]));
  const imageOf = new Map(products.map((p) => [p.id, p.imageUrl]));
  const sortOf = new Map(products.map((p) => [p.id, p.sortOrder]));
  // Stable display order: product sortOrder, then name (a gone product sorts last).
  const sortedItems = [...order.items].sort(
    (a, b) =>
      (sortOf.get(a.productId) ?? Number.MAX_SAFE_INTEGER) - (sortOf.get(b.productId) ?? Number.MAX_SAFE_INTEGER) ||
      (a.nameSnapshot < b.nameSnapshot ? -1 : a.nameSnapshot > b.nameSnapshot ? 1 : 0),
  );
  // Current product modes; a product that no longer exists counts as dough.
  const hasDoughItem = order.items.some((i) => mode.get(i.productId) !== "INDEPENDENT");

  const canCancel = customerCanCancel(order.status, now, order.cutoffAt);
  const pickupDate = fromDbDate(order.pickupDate);
  return {
    orderNo: order.orderNo,
    items: sortedItems.map((i) => ({
      name: i.nameSnapshot,
      qty: i.qty,
      lineTotalCents: i.lineTotalCents,
      imageUrl: imageOf.get(i.productId) ?? null,
    })),
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    pickupDate,
    pickupDateLabel: dayLabel(pickupDate),
    fulfillment: order.fulfillment,
    statusText: customerStatusText({
      status: order.status,
      fulfillment: order.fulfillment,
      hasDoughItem,
      ownerWechatId: settings.ownerWechatId,
      bakingTextBread: settings.bakingTextBread,
      bakingTextOther: settings.bakingTextOther,
    }),
    statusKind: statusKindOf(order.status),
    ownerWechatId: settings.ownerWechatId,
    pickupNote: settings.pickupNote || null,
    canCancel,
    cancelDeadlineLabel: canCancel
      ? copy.customer.order.cancelDeadline.replace("{label}", deadlineWithoutSuffix(order.cutoffAt))
      : null,
    note: order.note,
  };
}
