// Bookkeeping (D87): loads orders and manual entries, runs the pure domain/ledger.ts
// calculations, and owns the manual-entry writes (each one writes an AuditLog row in the
// same transaction, entity `manual_income`).

import { z } from "zod";
import { LEDGER_METHODS, dayDetail, monthBounds, monthSummary } from "@/domain/ledger";
import type {
  DayDetail,
  LedgerManualEntry,
  LedgerMethod,
  LedgerOrder,
  MonthSummary,
} from "@/domain/ledger";
import { isLocalDate } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { fromDbDate, toDbDate } from "./dbDates";
import { AppError } from "./errors";
import { issuesToFields } from "./orderSchemas";

/** Keeps every amount well inside Postgres INT. */
const AMOUNT_MAX = 100_000_000;
const MAX_ITEMS = 30;
const codePoints = (s: string) => [...s].length;

const localDate = z.string().refine(isLocalDate, { message: "Invalid date (YYYY-MM-DD)" });

export const monthQuerySchema = z.object({
  month: z
    .string()
    .refine((m) => /^\d{4}-\d{2}$/.test(m) && isLocalDate(`${m}-01`), { message: "Invalid month (YYYY-MM)" }),
});

export const dayQuerySchema = z.object({ date: localDate });

const itemSchema = z
  .object({
    productId: z.uuid().nullish(),
    name: z.string().trim().min(1).max(60).optional(),
    qty: z.number().int().min(1).max(999),
  })
  .refine((i) => i.productId || i.name, { message: "Product or name required", path: ["productId"] });

export const manualBodySchema = z.object({
  date: localDate,
  amountCents: z.number().int().min(1).max(AMOUNT_MAX),
  note: z
    .string()
    .trim()
    .refine((s) => codePoints(s) >= 1, { message: "Too short" })
    .refine((s) => codePoints(s) <= 100, { message: "At most 100 characters" }),
  paidMethod: z.enum(LEDGER_METHODS),
  items: z.array(itemSchema).max(MAX_ITEMS).default([]),
});

export type ManualBody = z.output<typeof manualBodySchema>;

export function parseManualBody(body: unknown): ManualBody {
  const result = manualBodySchema.safeParse(body);
  if (result.success) return result.data;
  throw new AppError("VALIDATION", { extra: { fields: issuesToFields(result.error) } });
}

export function parseMonth(query: unknown): string {
  const r = monthQuerySchema.safeParse(query);
  if (!r.success) throw new AppError("VALIDATION", { extra: { fields: issuesToFields(r.error) } });
  return r.data.month;
}

export function parseDay(query: unknown): LocalDate {
  const r = dayQuerySchema.safeParse(query);
  if (!r.success) throw new AppError("VALIDATION", { extra: { fields: issuesToFields(r.error) } });
  return r.data.date;
}

type DbOrTx = DbClient | Tx;

async function loadOrders(db: DbOrTx, first: LocalDate, last: LocalDate): Promise<LedgerOrder[]> {
  const rows = await db.order.findMany({
    where: { pickupDate: { gte: toDbDate(first), lte: toDbDate(last) } },
    select: {
      orderNo: true,
      wechatId: true,
      pickupDate: true,
      status: true,
      paid: true,
      paidMethod: true,
      totalCents: true,
      deliveryFeeCents: true,
      items: {
        select: { productId: true, nameSnapshot: true, qty: true, lineTotalCents: true },
        orderBy: { id: "asc" },
      },
    },
  });
  return rows.map((o) => ({
    orderNo: o.orderNo,
    wechatId: o.wechatId,
    pickupDate: fromDbDate(o.pickupDate),
    status: o.status,
    paid: o.paid,
    paidMethod: o.paidMethod,
    totalCents: o.totalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    items: o.items.map((i) => ({
      productId: i.productId,
      name: i.nameSnapshot,
      qty: i.qty,
      lineTotalCents: i.lineTotalCents,
    })),
  }));
}

const manualSelect = {
  id: true,
  date: true,
  amountCents: true,
  note: true,
  paidMethod: true,
  items: {
    select: { productId: true, nameSnapshot: true, qty: true },
    orderBy: { id: "asc" as const },
  },
} as const;

type ManualRow = {
  id: string;
  date: Date;
  amountCents: number;
  note: string;
  paidMethod: LedgerMethod;
  items: { productId: string | null; nameSnapshot: string; qty: number }[];
};

function toEntry(r: ManualRow): LedgerManualEntry {
  return {
    id: r.id,
    date: fromDbDate(r.date),
    amountCents: r.amountCents,
    note: r.note,
    paidMethod: r.paidMethod,
    items: r.items.map((i) => ({ productId: i.productId, name: i.nameSnapshot, qty: i.qty })),
  };
}

async function loadManual(db: DbOrTx, first: LocalDate, last: LocalDate): Promise<LedgerManualEntry[]> {
  const rows = await db.manualIncome.findMany({
    where: { date: { gte: toDbDate(first), lte: toDbDate(last) } },
    select: manualSelect,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toEntry);
}

export async function getLedgerMonth(db: DbClient, month: string): Promise<MonthSummary> {
  const { first, last } = monthBounds(month);
  const [orders, manual] = await Promise.all([loadOrders(db, first, last), loadManual(db, first, last)]);
  return monthSummary(month, orders, manual);
}

export async function getLedgerDay(db: DbClient, date: LocalDate): Promise<DayDetail> {
  const [orders, manual] = await Promise.all([loadOrders(db, date, date), loadManual(db, date, date)]);
  return dayDetail(date, orders, manual);
}

// ---------------------------------------------------------------- manual entry writes

/** Items with names resolved: a product link takes the product's current name. */
async function resolveItems(tx: Tx, items: ManualBody["items"]) {
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = ids.length
    ? await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return items.map((i, idx) => {
    if (i.productId) {
      const name = nameById.get(i.productId);
      if (!name) {
        throw new AppError("VALIDATION", {
          extra: { fields: { [`items.${idx}.productId`]: "Unknown product" } },
        });
      }
      return { productId: i.productId, nameSnapshot: name, qty: i.qty };
    }
    return { productId: null, nameSnapshot: i.name as string, qty: i.qty };
  });
}

function auditView(e: LedgerManualEntry) {
  return {
    date: e.date,
    amountCents: e.amountCents,
    note: e.note,
    paidMethod: e.paidMethod,
    items: e.items.map((i) => ({ productId: i.productId, name: i.name, qty: i.qty })),
  };
}

export async function createManualIncome(db: DbClient, body: ManualBody, now: Date): Promise<LedgerManualEntry> {
  return db.$transaction(async (tx) => {
    const items = await resolveItems(tx, body.items);
    const row = await tx.manualIncome.create({
      data: {
        date: toDbDate(body.date),
        amountCents: body.amountCents,
        note: body.note,
        paidMethod: body.paidMethod,
        createdAt: now,
        updatedAt: now,
        items: { create: items },
      },
      select: manualSelect,
    });
    const entry = toEntry(row);
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "manual_income.create",
      entityType: "manual_income",
      entityId: entry.id,
      before: null,
      after: auditView(entry),
      at: now,
    });
    return entry;
  });
}

async function lockAndLoad(tx: Tx, id: string): Promise<LedgerManualEntry> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "ManualIncome" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.manualIncome.findUnique({ where: { id }, select: manualSelect });
  if (!row) throw new AppError("NOT_FOUND");
  return toEntry(row);
}

export async function updateManualIncome(
  db: DbClient,
  id: string,
  body: ManualBody,
  now: Date,
): Promise<LedgerManualEntry> {
  return db.$transaction(async (tx) => {
    const before = await lockAndLoad(tx, id);
    const items = await resolveItems(tx, body.items);
    const row = await tx.manualIncome.update({
      where: { id },
      data: {
        date: toDbDate(body.date),
        amountCents: body.amountCents,
        note: body.note,
        paidMethod: body.paidMethod,
        updatedAt: now,
        items: { deleteMany: {}, create: items },
      },
      select: manualSelect,
    });
    const after = toEntry(row);
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "manual_income.update",
      entityType: "manual_income",
      entityId: id,
      before: auditView(before),
      after: auditView(after),
      at: now,
    });
    return after;
  });
}

export async function deleteManualIncome(db: DbClient, id: string, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const before = await lockAndLoad(tx, id);
    await tx.manualIncome.delete({ where: { id } });
    await writeAudit(tx, {
      actor: "ADMIN",
      action: "manual_income.delete",
      entityType: "manual_income",
      entityId: id,
      before: auditView(before),
      after: null,
      at: now,
    });
  });
}
