"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import { formatCents } from "@/domain/pricing";
import type { Fulfillment, OrderStatus, Violation } from "@/domain/types";
import { weekdaysLabel } from "@/lib/orderForm";
import { statusLabel } from "./statusUi";

const t = copy.admin.orders;

export const STATUS_ORDER: OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];

const chipTone: Record<OrderStatus, string> = {
  NEW: "bg-accent text-accent-ink",
  CONTACTED: "bg-soft text-foreground border border-line",
  CONFIRMED: "bg-soft text-foreground border border-line",
  BAKING: "bg-soft text-foreground border border-line",
  READY: "bg-soft text-foreground border border-line",
  COMPLETED: "bg-disabled text-disabled-ink",
  CANCELLED: "bg-disabled text-disabled-ink",
  REJECTED: "bg-disabled text-disabled-ink",
};

export function StatusChip({ status, fulfillment }: Readonly<{ status: OrderStatus; fulfillment?: Fulfillment }>) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${chipTone[status]}`}>
      {statusLabel(status, fulfillment)}
    </span>
  );
}

export function money(cents: number): string {
  return formatCents(cents);
}

/** Copies `text`; shows 已复制 for 2 seconds. */
export function CopyButton({
  text,
  label,
  doneLabel,
  className = "",
}: Readonly<{ text: string; label: string; doneLabel?: string; className?: string }>) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function onClick() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setState(ok ? "done" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-3 text-sm font-medium ${className}`}
    >
      {state === "done" ? (doneLabel ?? t.copied) : state === "failed" ? t.copyFailed : label}
    </button>
  );
}

/** Bottom sheet dialog. Escape and the backdrop close it unless `busy`. */
export function Sheet({
  title,
  onClose,
  busy,
  children,
}: Readonly<{ title: string; onClose: () => void; busy?: boolean; children: ReactNode }>) {
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-card p-4 pb-6 text-foreground"
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function describeViolation(v: Violation, productName: (id: string) => string): string {
  switch (v.kind) {
    case "DOUGH":
      return fill(t.violationDough, { date: v.date, after: v.after, limit: v.limit, over: v.over });
    case "PRODUCT":
      return fill(t.violationProduct, {
        date: v.date,
        name: productName(v.productId),
        after: v.after,
        limit: v.limit,
        over: v.over,
      });
    case "DELIVERY":
      return fill(t.violationDelivery, { date: v.date, after: v.after, limit: v.limit, over: v.over });
    case "DELIVERY_DISABLED":
      return fill(t.violationDeliveryDisabled, { date: v.date });
    case "WEEKDAY":
      return fill(t.violationWeekday, {
        date: v.date,
        name: productName(v.productId),
        days: weekdaysLabel(v.weekdays),
      });
  }
}

export const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-foreground";
export const primaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-base font-medium text-accent-ink disabled:bg-disabled disabled:text-disabled-ink";
export const secondaryBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-4 text-base font-medium disabled:opacity-50";
export const dangerBtn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-danger bg-card px-4 text-base font-medium text-danger disabled:opacity-50";
