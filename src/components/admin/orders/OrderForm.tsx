"use client";

// Admin order form, shared by the proxy order page (create) and "修改订单" (edit).
// Prices shown here are a preview; the server recomputes everything. An over-limit save
// lists every violation and asks for a reason before it is sent again with `override`.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import { formatCents } from "@/domain/pricing";
import type { Fulfillment } from "@/domain/types";
import { adminApi } from "@/lib/adminApi";
import {
  buildCreatePayload,
  buildEditPayload,
  describeViolation,
  estimate,
  parseViolations,
  type EditableOrder,
  type FormValues,
  type PriceSource,
} from "@/lib/orderForm";
import type { Violation } from "@/domain/types";
import type { FormDate, FormProduct, OrderFormData } from "@/server/orderForm";
import { AdminCard } from "../AdminCard";

const t = copy.admin.orderForm;
const WECHAT_MAX = 40;
const NOTE_MAX = 300;
const REASON_MAX = 500;
const QTY_MAX = 100;

const fieldClass =
  "mt-1 min-h-12 w-full rounded-lg border border-line bg-background px-3 text-base focus:border-accent focus:outline-none";
const primaryButton =
  "min-h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-ink active:bg-accent-strong disabled:bg-disabled disabled:text-disabled-ink";
const outlineButton = "min-h-12 rounded-full border border-accent px-5 font-medium text-accent";

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

function safeDay(date: string): string {
  try {
    return dayLabel(date);
  } catch {
    return date;
  }
}

interface Pending {
  violations: Violation[];
}

interface Created {
  id: string;
  orderNo: string;
  url: string;
}

export interface OrderFormProps {
  data: OrderFormData;
  /** Present = edit mode. */
  order?: EditableOrder;
}

/** Usage line of PAGES.md, e.g. "1460 / 1600 g · 配送 5 / 8". */
function usageText(d: FormDate): string {
  const dough = fill(t.usageDough, { used: d.doughG, limit: d.doughLimitG });
  return d.deliveryEnabled
    ? `${dough} · ${fill(t.usageDelivery, { used: d.deliveries, limit: d.deliveryLimit })}`
    : `${dough} · ${t.noDelivery}`;
}

/** Open dates plus the order's own date (even when closed or past), ascending. */
function datesWithCurrent(open: FormDate[], current: string | undefined): FormDate[] {
  if (!current || open.some((d) => d.date === current)) return open;
  const own: FormDate = {
    date: current,
    label: safeDay(current),
    isOpen: false,
    deliveryEnabled: true,
    doughG: 0,
    doughLimitG: 0,
    deliveries: 0,
    deliveryLimit: 0,
  };
  return [...open, own].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function OrderForm({ data, order }: OrderFormProps) {
  const dates = useMemo(() => datesWithCurrent(data.dates, order?.pickupDate), [data.dates, order]);
  const router = useRouter();
  const editing = order !== undefined;

  const initial: FormValues = useMemo(
    () => ({
      items: order ? order.items.map((i) => ({ productId: i.productId, qty: i.qty })) : [],
      pickupDate: order ? order.pickupDate : "",
      fulfillment: order ? order.fulfillment : "PICKUP",
      wechatId: order ? order.wechatId : "",
      note: order ? (order.note ?? "") : "",
    }),
    [order],
  );

  // Products on offer: the live ones, plus products already on the order (even archived).
  const products: Omit<FormProduct, "capacityMode">[] = useMemo(() => {
    const list: Omit<FormProduct, "capacityMode">[] = [...data.products];
    for (const i of order?.items ?? []) {
      if (!list.some((p) => p.id === i.productId)) {
        list.push({
          id: i.productId,
          name: i.name,
          status: "ARCHIVED",
          unitPriceCents: i.unitPriceCents,
          bundleSize: i.bundleSize,
          bundlePriceCents: i.bundlePriceCents,
        });
      }
    }
    return list;
  }, [data.products, order]);

  // Existing lines keep their snapshot price (D45); new ones use the current price.
  const prices = useMemo(() => {
    const map: Record<string, PriceSource> = {};
    for (const p of products) map[p.id] = p;
    for (const i of order?.items ?? []) map[i.productId] = i;
    return map;
  }, [products, order]);
  const names = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);

  const baseline = initial;
  const stamp = order?.updatedAt ?? "";
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(initial.items.map((l) => [l.productId, l.qty])),
  );
  const [pickupDate, setPickupDate] = useState<string>(initial.pickupDate);
  const [fulfillment, setFulfillment] = useState<Fulfillment>(initial.fulfillment);
  const [wechatId, setWechatId] = useState(initial.wechatId);
  const [note, setNote] = useState(initial.note);

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; stale?: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const submittingRef = useRef(false);

  const values: FormValues = {
    items: Object.entries(qty).map(([productId, q]) => ({ productId, qty: q })),
    pickupDate: pickupDate as FormValues["pickupDate"],
    fulfillment,
    wechatId,
    note,
  };
  const est = estimate(values.items, prices, fulfillment, data.fees);
  const itemCount = values.items.filter((l) => l.qty > 0).length;

  /** Any edit makes the listed violations stale: close the panel so 仍然保存 cannot override them. */
  function closeOverride() {
    setPending(null);
    setReason("");
    setReasonError(null);
  }

  function setLineQty(productId: string, next: number) {
    closeOverride();
    setQty((q) => ({ ...q, [productId]: Math.max(0, Math.min(QTY_MAX, next)) }));
    setFieldError(null);
    setError(null);
  }

  async function send(override: boolean) {
    if (submittingRef.current) return;
    setError(null);
    setFieldError(null);
    setWechatError(null);
    setReasonError(null);

    if (override && !reason.trim()) {
      setReasonError(t.overReasonRequired);
      return;
    }
    if (!override) {
      if (itemCount === 0) return setFieldError(t.pickItems);
      if (!pickupDate) return setFieldError(t.pickDate);
      if (!wechatId.trim()) return setWechatError(t.wechatRequired);
    }
    const ov = override ? { override: true as const, reason } : undefined;

    let result;
    submittingRef.current = true;
    setSubmitting(true);
    if (editing) {
      const payload = buildEditPayload(baseline, values, stamp, ov);
      if (!payload) {
        submittingRef.current = false;
        setSubmitting(false);
        return setError({ message: t.nothingChanged });
      }
      result = await adminApi<{ updatedAt: string }>(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: payload,
      });
    } else {
      result = await adminApi<{ id: string; orderNo: string; viewUrl: string }>("/api/admin/orders", {
        method: "POST",
        body: buildCreatePayload(values, ov),
      });
    }
    submittingRef.current = false;
    setSubmitting(false);

    if (result.ok) {
      setPending(null);
      setReason("");
      if (editing) {
        router.push(`/admin/orders/${order.id}`);
      } else {
        const d = result.data as { id: string; orderNo: string; viewUrl: string };
        setCreated({ id: d.id, orderNo: d.orderNo, url: d.viewUrl });
      }
      return;
    }

    switch (result.error) {
      case "OVER_LIMIT": {
        const violations = parseViolations(result.violations);
        if (override) {
          // Still over after the owner confirmed: should not happen; show the lines again.
          setError({ message: result.message });
        }
        setPending({ violations });
        return;
      }
      case "STALE":
        setPending(null);
        setError({ message: t.staleTitle, stale: true });
        return;
      case "VALIDATION": {
        const fields = (result.fields ?? {}) as Record<string, string>;
        if (fields.wechatId) setWechatError(t.wechatRequired);
        else if (fields.reason) setReasonError(t.overReasonRequired);
        else setError({ message: copy.errors.fallback });
        return;
      }
      default:
        setPending(null);
        setError({ message: result.message });
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(false);
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (created) {
    return (
      <AdminCard title={t.createdTitle}>
        <div className="flex flex-col gap-3" data-testid="created">
          <p data-testid="created-no">{fill(t.createdNo, { orderNo: created.orderNo })}</p>
          <a href={`/admin/orders/${created.id}`} className="text-accent underline">
            {t.viewDetail}
          </a>
          <p className="text-sm text-muted">{t.createdLinkHint}</p>
          <input
            readOnly
            aria-label={t.copyLink}
            className={fieldClass}
            value={created.url}
            data-testid="created-url"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className={primaryButton} onClick={() => void copyLink(created.url)}>
            {copied ? t.copied : t.copyLink}
          </button>
          {/* Full page load on purpose: it resets every field for the next phone order. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/admin/orders/new" className={`${outlineButton} flex items-center justify-center`}>
            {t.newAnother}
          </a>
          <Link href="/admin/orders" className="flex min-h-11 items-center justify-center text-sm text-muted">
            {t.backToOrders}
          </Link>
        </div>
      </AdminCard>
    );
  }

  const productNames = names;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate data-testid="order-form">
      <AdminCard title={t.itemsTitle}>
        <ul className="flex flex-col divide-y divide-line">
          {products.map((p) => {
            const q = qty[p.id] ?? 0;
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2" data-product-id={p.id}>
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {p.name}
                    {p.status === "PAUSED" ? <span className="text-sm text-muted">{t.paused}</span> : null}
                  </p>
                  <p className="text-sm text-muted tabular-nums">
                    {formatCents(prices[p.id].unitPriceCents)}
                    {order?.items.some((i) => i.productId === p.id) ? ` ${t.snapshotNote}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`${fill(t.qtyLabel, { name: p.name })} ${t.decrease}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-xl disabled:opacity-40"
                    disabled={q <= 0}
                    onClick={() => setLineQty(p.id, q - 1)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={QTY_MAX}
                    aria-label={fill(t.qtyLabel, { name: p.name })}
                    className="h-11 w-14 rounded-lg border border-line bg-background text-center text-base tabular-nums"
                    value={q}
                    data-testid="qty"
                    onChange={(e) => setLineQty(p.id, Number.parseInt(e.target.value, 10) || 0)}
                  />
                  <button
                    type="button"
                    aria-label={`${fill(t.qtyLabel, { name: p.name })} ${t.increase}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-xl disabled:opacity-40"
                    disabled={q >= QTY_MAX}
                    onClick={() => setLineQty(p.id, q + 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCard>

      <AdminCard title={t.dateTitle}>
        <p className="mb-3 text-sm text-muted">{t.dateHint}</p>
        {editing && pickupDate && pickupDate !== order.pickupDate ? (
          <p className="mb-3 rounded-lg bg-soft px-3 py-2 text-sm" data-testid="date-hint">
            {t.dateChangeHint}
          </p>
        ) : null}
        {dates.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-dates">
            {t.noDates}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.dateTitle}>
            {dates.map((d) => {
              const selected = pickupDate === d.date;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid="date-card"
                  data-date={d.date}
                  className={`flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left ${
                    selected ? "border-accent bg-soft ring-2 ring-accent" : "border-line bg-card"
                  }`}
                  onClick={() => {
                    closeOverride();
                    setPickupDate(d.date);
                    setFieldError(null);
                    setError(null);
                  }}
                >
                  <span className="text-base font-semibold">{d.label}</span>
                  <span className="text-xs text-muted">{d.isOpen ? usageText(d) : t.closedDate}</span>
                </button>
              );
            })}
          </div>
        )}
      </AdminCard>

      <AdminCard title={t.fulfillmentTitle}>
        <div className="flex gap-2" role="radiogroup" aria-label={t.fulfillmentTitle}>
          {(["PICKUP", "DELIVERY"] as const).map((f) => {
            const checked = fulfillment === f;
            return (
              <label
                key={f}
                className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border ${
                  checked ? "border-accent bg-soft" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="fulfillment"
                  value={f}
                  checked={checked}
                  onChange={() => {
                    closeOverride();
                    setFulfillment(f);
                  }}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
                <span className="font-medium">{f === "PICKUP" ? t.pickup : t.delivery}</span>
              </label>
            );
          })}
        </div>
      </AdminCard>

      <AdminCard>
        <label className="flex flex-col">
          <span className="text-base font-semibold">{t.wechatLabel}</span>
          <input
            name="wechatId"
            className={fieldClass}
            value={wechatId}
            maxLength={WECHAT_MAX}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={wechatError ? true : undefined}
            onChange={(e) => {
              closeOverride();
              setWechatId(e.target.value);
              setWechatError(null);
            }}
          />
        </label>
        {wechatError ? (
          <p role="alert" className="mt-1 text-sm text-danger" data-testid="wechat-error">
            {wechatError}
          </p>
        ) : null}
        <label className="mt-4 flex flex-col">
          <span className="text-base font-semibold">{t.noteLabel}</span>
          <textarea
            name="note"
            rows={3}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base focus:border-accent focus:outline-none"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => {
              closeOverride();
              setNote(e.target.value.slice(0, NOTE_MAX));
            }}
          />
        </label>
      </AdminCard>

      <AdminCard title={t.estimateTitle}>
        <dl className="flex flex-col gap-1 text-sm tabular-nums" data-testid="estimate">
          <div className="flex justify-between">
            <dt>{t.subtotal}</dt>
            <dd>{formatCents(est.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t.deliveryFee}</dt>
            <dd>{formatCents(est.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>{t.total}</dt>
            <dd data-testid="estimate-total">{formatCents(est.totalCents)}</dd>
          </div>
        </dl>
      </AdminCard>

      {fieldError ? (
        <p role="alert" className="rounded-xl bg-soft p-3 text-sm text-danger" data-testid="field-error">
          {fieldError}
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-xl bg-soft p-3 text-sm text-danger" data-testid="form-error">
          <p>{error.message}</p>
          {error.stale ? (
            <button
              type="button"
              className="mt-2 min-h-11 rounded-full border border-accent px-4 font-medium text-accent"
              onClick={() => window.location.reload()}
            >
              {t.refresh}
            </button>
          ) : null}
        </div>
      ) : null}


      {pending ? (
        <section
          className="rounded-xl border border-danger bg-card p-4"
          role="alertdialog"
          aria-label={t.overTitle}
          data-testid="over-limit"
        >
          <h2 className="text-base font-semibold text-danger">{t.overTitle}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm" data-testid="violations">
            {pending.violations.map((v, i) => (
              <li key={i}>{describeViolation(v, productNames)}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">{t.overHint}</p>
          <label className="mt-3 flex flex-col">
            <span className="text-sm font-semibold">{t.overReasonLabel}</span>
            <textarea
              name="reason"
              rows={2}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base focus:border-accent focus:outline-none"
              value={reason}
              maxLength={REASON_MAX}
              aria-invalid={reasonError ? true : undefined}
              data-testid="reason"
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
            />
          </label>
          {reasonError ? (
            <p role="alert" className="mt-1 text-sm text-danger" data-testid="reason-error">
              {reasonError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={submitting}
              data-testid="override-confirm"
              onClick={() => void send(true)}
            >
              {submitting ? t.submitting : t.overConfirm}
            </button>
            <button
              type="button"
              className={outlineButton}
              disabled={submitting}
              onClick={closeOverride}
            >
              {t.overCancel}
            </button>
          </div>
        </section>
      ) : (
        <button type="submit" className={primaryButton} disabled={submitting} data-testid="submit">
          {submitting ? t.submitting : editing ? t.submitEdit : t.submitNew}
        </button>
      )}
    </form>
  );
}
