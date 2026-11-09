// Shape of GET /api/o/{token} (API_SPEC.md §2). Customer-visible fields only.

export type StatusKind = "PENDING" | "CONFIRMED" | "BAKING" | "READY" | "COMPLETED" | "CANCELLED";

export type OrderViewData = {
  orderNo: string;
  items: {
    name: string;
    flavorName?: string | null;
    qty: number;
    lineTotalCents: number;
    imageUrl: string | null;
    /** D192 拼单 lines: the pool's state and whether this line's pieces will be made. */
    poolStatus?: "OPEN" | "FORMED" | "CONFIRMED" | "FAILED";
    willBake?: boolean;
    /** D194 现货 line. */
    stock?: boolean;
  }[];
  /** 面包币 the order earns once completed (0 when cancelled; E1). */
  coinsOnPickup?: number;
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
};

/** Replaces each {key} in a copy.ts template. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
