// Shape of GET /api/o/{token} (API_SPEC.md §2). Customer-visible fields only.

export type StatusKind = "PENDING" | "CONFIRMED" | "BAKING" | "READY" | "COMPLETED" | "CANCELLED";

export type OrderViewData = {
  orderNo: string;
  items: { name: string; qty: number; lineTotalCents: number }[];
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
  wechatId: string;
};

/** Replaces each {key} in a copy.ts template. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
