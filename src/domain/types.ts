// Shared domain types. Pure: no Prisma, no runtime clock.
// Mirrors docs/DATA_MODEL.md; field names match the future Prisma models.

export type CapacityMode = "DOUGH_PER_UNIT" | "DOUGH_PER_ROUND" | "INDEPENDENT";
export type ProductStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export type OrderStatus =
  | "NEW"
  | "CONTACTED"
  | "CONFIRMED"
  | "BAKING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED";
export type Fulfillment = "PICKUP" | "DELIVERY";
export type Actor = "ADMIN" | "CUSTOMER" | "SYSTEM";

/** Calendar day in America/Chicago, formatted YYYY-MM-DD. */
export type LocalDate = string;
/** Integer US cents. */
export type Cents = number;

/** Statuses that occupy capacity (CAPACITY_RULES.md §1). */
export const OCCUPYING_STATUSES: readonly OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
];

export interface PriceSnapshot {
  unitPriceCents: Cents;
  bundleSize: number;
  /** null = no bundle */
  bundlePriceCents: Cents | null;
}

/** Current capacity settings of a product (capacity always uses current settings, D45). */
export interface CapacityProduct {
  id: string;
  capacityMode: CapacityMode;
  doughG: number | null;
  roundG: number | null;
  piecesPerRound: number | null;
  /** Default daily limit for INDEPENDENT products. */
  dailyLimit: number | null;
  leadDays: number;
  /**
   * Weekdays (0 = Sunday … 6 = Saturday, Chicago date of the pickup) this product can be
   * picked up on (D115). Absent or empty = every day.
   */
  pickupWeekdays?: readonly number[];
}

export interface CartLine {
  productId: string;
  qty: number;
}

/** An existing order as capacity sees it. */
export interface DayOrder {
  id: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  items: CartLine[];
}

/** Limits for one open date, already resolved (OpenDate override ?? Setting/product default). */
export interface DayLimits {
  doughLimitG: number;
  deliveryEnabled: boolean;
  deliveryLimit: number;
  /** productId -> limit, for every INDEPENDENT product. */
  productLimits: Record<string, number>;
}

export interface Usage {
  doughG: number;
  /** productId -> total qty, for INDEPENDENT products. */
  products: Record<string, number>;
  deliveries: number;
}

export type Violation =
  | { kind: "DOUGH"; date: LocalDate; limit: number; after: number; over: number }
  | { kind: "PRODUCT"; date: LocalDate; productId: string; limit: number; after: number; over: number }
  | { kind: "DELIVERY"; date: LocalDate; limit: number; after: number; over: number }
  | { kind: "DELIVERY_DISABLED"; date: LocalDate }
  /** The product cannot be picked up on this weekday (D115); `weekdays` = the allowed ones. */
  | { kind: "WEEKDAY"; date: LocalDate; productId: string; weekdays: number[] };

export interface FeeSettings {
  deliveryFeeCents: Cents;
  freeDeliveryMinCents: Cents;
}
