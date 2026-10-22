"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import type { OrderStatus, Violation } from "@/domain/types";
import { adminApi } from "@/lib/adminApi";
import type { OrderDetail, OrderLogEntry } from "@/server/orderQueries";
import {
  CopyButton,
  dangerBtn,
  describeViolation,
  inputClass,
  money,
  primaryBtn,
  secondaryBtn,
  Sheet,
  STATUS_ORDER,
  StatusChip,
} from "./shared";

const t = copy.admin.orders;
const METHODS = ["WECHAT", "ZELLE", "VENMO", "CASH", "OTHER"] as const;

type SheetState =
  | { kind: "reason"; to: "REJECTED" | "CANCELLED" }
  | { kind: "correct" }
  | null;

function fmtTime(iso: string): string {
  // Chicago wall time, like the rest of the shop.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return parts;
}

function fmtValue(key: string, v: unknown, productName: (id: string) => string): string {
  if (v === null || v === undefined || v === "") return t.emptyValue;
  switch (key) {
    case "status":
      return t.statusLabels[v as OrderStatus] ?? String(v);
    case "paid":
      return v ? t.yes : t.no;
    case "paidMethod":
      return t.paymentMethods[v as keyof typeof t.paymentMethods] ?? String(v);
    case "fulfillment":
      return v === "DELIVERY" ? t.delivery : t.pickup;
    case "pickupDate":
      try {
        return dayLabel(String(v));
      } catch {
        return String(v);
      }
    case "subtotalCents":
    case "deliveryFeeCents":
    case "totalCents":
      return typeof v === "number" ? money(v) : String(v);
    case "items":
      return Array.isArray(v)
        ? v.map((i: { name?: string; qty?: number }) => `${i.name ?? ""}×${i.qty ?? ""}`).join("、")
        : String(v);
    case "violations":
      return Array.isArray(v) ? (v as Violation[]).map((x) => describeViolation(x, productName)).join("；") : String(v);
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

const HIDDEN_KEYS = new Set(["paidAt", "cutoffAt"]);

function LogItem({ log, productName }: Readonly<{ log: OrderLogEntry; productName: (id: string) => string }>) {
  const before = (log.before ?? {}) as Record<string, unknown>;
  const after = (log.after ?? {}) as Record<string, unknown>;
  const keys = Object.keys(after).filter((k) => !HIDDEN_KEYS.has(k));
  const actor = log.actor === "ADMIN" ? t.logActorAdmin : log.actor === "CUSTOMER" ? t.logActorCustomer : t.logActorSystem;
  const label = (t.logActions as Record<string, string>)[log.action] ?? log.action;
  return (
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0" data-testid="log-entry">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {label} <span className="text-sm text-muted">· {actor}</span>
        </span>
        <span className="shrink-0 text-sm text-muted">{fmtTime(log.at)}</span>
      </div>
      {keys.map((k) => {
        const name = (t.logFields as Record<string, string>)[k] ?? k;
        const changed = k in before;
        const text = changed
          ? `${fmtValue(k, before[k], productName)}${t.arrow}${fmtValue(k, after[k], productName)}`
          : fmtValue(k, after[k], productName);
        // Unchanged values are not worth a line.
        if (changed && JSON.stringify(before[k]) === JSON.stringify(after[k])) return null;
        return (
          <div key={k} className="mt-1 break-words text-sm">
            <span className="text-muted">{name}：</span>
            {text}
          </div>
        );
      })}
      {log.reason && <div className="mt-1 text-sm">{fill(t.logReason, { reason: log.reason })}</div>}
    </li>
  );
}

export function OrderDetailPage({ id }: Readonly<{ id: string }>) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);

  const load = useCallback(async () => {
    const res = await adminApi<OrderDetail>(`/api/admin/orders/${id}`);
    if (!res.ok) {
      setLoadError(res.message);
      return;
    }
    setLoadError(null);
    setOrder(res.data);
  }, [id]);

  useEffect(() => {
    // Fetching on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loadError && !order) {
    return (
      <>
        <PageHeader title={t.detailTitle} backHref="/admin/orders" />
        <div role="alert" className="rounded-lg border border-danger p-3 text-danger">
          {loadError}{" "}
          <button type="button" className="min-h-11 underline" onClick={() => void load()}>
            {t.retry}
          </button>
        </div>
      </>
    );
  }
  if (!order) {
    return (
      <>
        <PageHeader title={t.detailTitle} backHref="/admin/orders" />
        <p className="py-8 text-center text-muted">{t.loading}</p>
      </>
    );
  }

  const names = new Map(order.items.map((i) => [i.productId, i.name]));
  const productName = (pid: string) => names.get(pid) ?? pid;

  /** Runs a write; STALE reloads. Returns the failed result, or null on success. */
  async function act(path: string, body: Record<string, unknown>) {
    if (!order || busy) return null;
    setBusy(true);
    setActionError(null);
    const res = await adminApi(`/api/admin/orders/${order.id}/${path}`, {
      body: { ...body, expectedUpdatedAt: order.updatedAt },
    });
    setBusy(false);
    if (!res.ok) {
      if (res.error === "STALE") {
        setActionError(copy.errors.STALE);
        setSheet(null);
        await load();
      } else if (res.error !== "OVER_LIMIT") {
        setActionError(res.message);
      }
      return res;
    }
    setSheet(null);
    await load();
    return null;
  }

  const forward = order.nextStatuses.filter((n) => !n.reasonRequired);
  const reasonOnes = order.nextStatuses.filter((n) => n.reasonRequired);

  return (
    <>
      <PageHeader title={order.orderNo} backHref="/admin/orders" actions={<StatusChip status={order.status} />} />

      {actionError && (
        <div role="alert" className="mb-3 rounded-lg border border-danger p-3 text-danger">
          {actionError}
        </div>
      )}

      <div className="space-y-4">
        <AdminCard title={t.sectionStatus}>
          <div className="flex flex-col gap-2">
            {forward.map((n) => (
              <button
                key={n.to}
                type="button"
                disabled={busy}
                className={primaryBtn}
                onClick={() => void act("status", { to: n.to })}
              >
                {t.moveTo[n.to as keyof typeof t.moveTo]}
              </button>
            ))}
            {reasonOnes.map((n) => (
              <button
                key={n.to}
                type="button"
                disabled={busy}
                className={dangerBtn}
                onClick={() => setSheet({ kind: "reason", to: n.to as "REJECTED" | "CANCELLED" })}
              >
                {n.to === "REJECTED" ? t.reject : t.cancel}
              </button>
            ))}
            {order.nextStatuses.length === 0 && <p className="text-sm text-muted">{t.noNextStatus}</p>}
            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setSheet({ kind: "correct" })}>
              {t.correct}
            </button>
          </div>
        </AdminCard>

        <AdminCard title={t.sectionItems}>
          <ul className="space-y-1">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>{fill(t.itemLine, { name: i.name, qty: i.qty })}</span>
                <span>{money(i.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt>{t.subtotal}</dt>
              <dd>{money(order.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t.deliveryFee}</dt>
              <dd>{money(order.deliveryFeeCents)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>{t.total}</dt>
              <dd>{money(order.totalCents)}</dd>
            </div>
          </dl>
        </AdminCard>

        <AdminCard title={t.sectionInfo}>
          <dl className="space-y-2 text-base">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <dt className="text-sm text-muted">{t.wechat}</dt>
                <dd className="break-all">{order.wechatId}</dd>
              </div>
              <CopyButton text={order.wechatId} label={t.copyWechat} />
            </div>
            <div>
              <dt className="text-sm text-muted">{t.pickupDate}</dt>
              <dd>{order.pickupDateLabel}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t.fulfillment}</dt>
              <dd>{order.fulfillment === "DELIVERY" ? t.delivery : t.pickup}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t.note}</dt>
              <dd className="break-words">{order.note ?? t.noNote}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t.cutoff}</dt>
              <dd>{fmtTime(order.cutoffAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t.source}</dt>
              <dd>{order.source === "ADMIN" ? t.sourceAdmin : t.sourceWeb}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t.createdAt}</dt>
              <dd>{fmtTime(order.createdAt)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-col gap-2">
            <CopyButton text={order.viewUrl} label={t.copyLink} doneLabel={t.linkCopied} className="w-full" />
            <Link href={`/admin/orders/${order.id}/edit`} className={secondaryBtn}>
              {t.edit}
            </Link>
          </div>
        </AdminCard>

        <AdminCard title={t.sectionPayment}>
          <label className="flex min-h-11 items-center gap-3 text-base">
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={order.paid}
              disabled={busy}
              onChange={(e) => void act("payment", { paid: e.target.checked, method: order.paidMethod })}
            />
            {t.paymentToggle}
          </label>
          {order.paid && (
            <label className="mt-2 block text-sm">
              {t.paymentMethod}
              <select
                className={`${inputClass} mt-1`}
                value={order.paidMethod ?? ""}
                disabled={busy}
                onChange={(e) => void act("payment", { paid: true, method: e.target.value || null })}
              >
                <option value="">{t.paymentNone}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t.paymentMethods[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </AdminCard>

        <AdminCard title={t.sectionLogs}>
          {order.logs.length === 0 ? (
            <p className="text-sm text-muted">{t.logEmpty}</p>
          ) : (
            <ul>
              {order.logs.map((l) => (
                <LogItem key={l.id} log={l} productName={productName} />
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      {sheet?.kind === "reason" && (
        <ReasonSheet
          key={sheet.to}
          title={sheet.to === "REJECTED" ? t.rejectTitle : t.cancelTitle}
          confirmLabel={sheet.to === "REJECTED" ? t.confirmReject : t.confirmCancel}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={async (reason) => {
            const res = await act("status", { to: sheet.to, reason });
            return res && !res.ok ? res.message : null;
          }}
        />
      )}
      {sheet?.kind === "correct" && (
        <CorrectSheet
          current={order.status}
          busy={busy}
          productName={productName}
          onClose={() => setSheet(null)}
          onSubmit={(to, reason, override) => act("correct-status", { to, reason, override })}
        />
      )}
    </>
  );
}

function ReasonSheet({
  title,
  confirmLabel,
  busy,
  onClose,
  onSubmit,
}: Readonly<{
  title: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<string | null>;
}>) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError(t.reasonRequired);
      return;
    }
    setError(await onSubmit(reason.trim()));
  }

  return (
    <Sheet title={title} onClose={onClose} busy={busy}>
      <label className="block text-sm">
        {t.reasonLabel}
        <textarea
          className={`${inputClass} mt-1 py-2`}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} disabled={busy} onClick={onClose}>
          {t.sheetBack}
        </button>
        <button type="button" className={`${dangerBtn} flex-1`} disabled={busy} onClick={() => void submit()}>
          {busy ? t.working : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

function CorrectSheet({
  current,
  busy,
  productName,
  onClose,
  onSubmit,
}: Readonly<{
  current: OrderStatus;
  busy: boolean;
  productName: (id: string) => string;
  onClose: () => void;
  onSubmit: (
    to: OrderStatus,
    reason: string,
    override: boolean,
  ) => Promise<null | { ok: false; error: string; message: string; violations?: unknown }>;
}>) {
  const options = STATUS_ORDER.filter((s) => s !== current);
  const [to, setTo] = useState<OrderStatus>(options[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<Violation[] | null>(null);

  async function submit(override: boolean) {
    if (!reason.trim()) {
      setError(t.reasonRequired);
      return;
    }
    setError(null);
    const res = await onSubmit(to, reason.trim(), override);
    if (!res) return;
    if (res.error === "OVER_LIMIT") {
      setViolations(Array.isArray(res.violations) ? (res.violations as Violation[]) : []);
    } else {
      setError(res.message);
    }
  }

  return (
    <Sheet title={t.correctTitle} onClose={onClose} busy={busy}>
      <label className="block text-sm">
        {t.correctTo}
        <select
          className={`${inputClass} mt-1`}
          value={to}
          onChange={(e) => {
            setTo(e.target.value as OrderStatus);
            setViolations(null);
          }}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {t.statusLabels[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm">
        {t.reasonLabel}
        <textarea className={`${inputClass} mt-1 py-2`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {violations && (
        <div role="alert" className="mt-3 rounded-lg border border-danger p-3 text-sm text-danger">
          <p className="font-medium">{t.overLimitTitle}</p>
          <ul className="mt-1 list-disc pl-5">
            {violations.map((v, i) => (
              <li key={i}>{describeViolation(v, productName)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {violations ? (
          <button type="button" className={dangerBtn} disabled={busy} onClick={() => void submit(true)}>
            {busy ? t.working : t.confirmOverride}
          </button>
        ) : (
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void submit(false)}>
            {busy ? t.working : t.confirmCorrect}
          </button>
        )}
        <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
          {t.sheetBack}
        </button>
      </div>
    </Sheet>
  );
}
