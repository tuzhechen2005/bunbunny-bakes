"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { primaryBtn, secondaryBtn } from "@/components/admin/orders/shared";
import { useProducts } from "@/components/admin/products/useProducts";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { dayLabel, localDateOf, monthDay } from "@/domain/dates";
import {
  LEDGER_BUCKETS,
  monthBounds,
  rangeDayCount,
  shiftMonth,
  shiftRange,
  weekBounds,
  type DayDetail,
  type LedgerManualEntry,
  type MethodTotals,
  type RangeSummary,
} from "@/domain/ledger";
import { formatCents } from "@/domain/pricing";
import { adminApi } from "@/lib/adminApi";
import { DeleteSheet, EntryFormSheet } from "./EntrySheet";

const t = copy.admin.ledger;

type Modal =
  | { kind: "form"; entry: LedgerManualEntry | null; date: string }
  | { kind: "delete"; entry: LedgerManualEntry }
  | null;

const navBtn = "flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-card px-3 text-base";

/** D190: what the ledger sums. A month is a preset range; 自选 is any 1–366 days. */
type Mode = "day" | "week" | "month" | "range";
interface Period {
  mode: Mode;
  from: string;
  to: string;
}
const MODES: Mode[] = ["day", "week", "month", "range"];
const MAX_DAYS = 366;

function periodFor(mode: Mode, anchor: string, current?: Period): Period {
  if (mode === "day") return { mode, from: anchor, to: anchor };
  if (mode === "week") return { mode, ...weekBounds(anchor) };
  if (mode === "month") {
    const { first, last } = monthBounds(anchor.slice(0, 7));
    return { mode, from: first, to: last };
  }
  // 自选 starts from what was on screen.
  return { mode, from: current?.from ?? anchor, to: current?.to ?? anchor };
}

function shiftPeriod(p: Period, delta: 1 | -1): Period {
  if (p.mode === "month") return periodFor("month", `${shiftMonth(p.from.slice(0, 7), delta)}-01`);
  const days = p.mode === "day" ? 1 : p.mode === "week" ? 7 : rangeDayCount(p.from, p.to);
  return { ...p, ...shiftRange(p.from, p.to, delta * days) };
}

function periodLabel(p: Period): string {
  if (p.mode === "day") return dayLabel(p.from);
  if (p.mode === "month") {
    const [year, month] = p.from.split("-").map(Number);
    return fill(t.monthLabel, { year, month });
  }
  return fill(t.rangeLabel, { from: monthDay(p.from), to: monthDay(p.to) });
}

/** 自选: keeps from <= to and the span within 366 days, moving the other end when needed. */
function clampRange(from: string, to: string, moved: "from" | "to"): { from: string; to: string } {
  if (to < from) return moved === "from" ? { from, to: from } : { from: to, to };
  if (rangeDayCount(from, to) > MAX_DAYS) {
    return moved === "from" ? { from, to: shiftRange(from, from, MAX_DAYS - 1).to } : { from: shiftRange(to, to, 1 - MAX_DAYS).from, to };
  }
  return { from, to };
}

function Stat({ label, value, testId }: Readonly<{ label: string; value: string; testId: string }>) {
  return (
    <div className="rounded-lg bg-soft px-3 py-2">
      <div className="text-sm text-muted">{label}</div>
      <div className="text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function Totals({
  revenueCents,
  qty,
  deliveryFeeCents,
  receivableCents,
  byMethod,
  prefix,
}: Readonly<{
  revenueCents: number;
  qty: number;
  deliveryFeeCents: number;
  receivableCents: number;
  byMethod: MethodTotals;
  prefix: string;
}>) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t.revenue} value={formatCents(revenueCents)} testId={`${prefix}-revenue`} />
        <Stat label={t.qty} value={String(qty)} testId={`${prefix}-qty`} />
        <Stat label={t.delivery} value={formatCents(deliveryFeeCents)} testId={`${prefix}-delivery`} />
        <Stat label={t.receivable} value={formatCents(receivableCents)} testId={`${prefix}-receivable`} />
      </div>
      <h3 className="mt-3 mb-1 text-sm font-medium text-muted">{t.byMethod}</h3>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-6">
        {LEDGER_BUCKETS.map((m) => (
          <li key={m} className="flex justify-between gap-2">
            <span>{t.methods[m]}</span>
            <span data-testid={`${prefix}-method-${m}`}>{formatCents(byMethod[m])}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Failed({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  return (
    <p role="alert" className="text-sm text-danger">
      {message}{" "}
      <button type="button" className="min-h-11 underline" onClick={onRetry}>
        {t.retry}
      </button>
    </p>
  );
}

function RangeView({
  period,
  data,
  error,
  onRetry,
  onOpenDay,
}: Readonly<{
  period: Period;
  data: RangeSummary | null;
  error: string | null;
  onRetry: () => void;
  onOpenDay: (date: string) => void;
}>) {
  if (error) return <Failed message={error} onRetry={onRetry} />;
  if (!data || data.from !== period.from || data.to !== period.to) return <p className="text-muted">{t.loading}</p>;
  // The range lists every day; only days with something on them are worth a row.
  const days = data.days.filter((d) => d.revenueCents > 0 || d.qty > 0 || d.receivableCents > 0);
  return (
    <>
      <AdminCard className="mb-3">
        <Totals {...data} prefix="month" />
      </AdminCard>
      <AdminCard title={t.daysTitle}>
        {days.length === 0 ? (
          <p className="text-muted" data-testid="ledger-month-empty">
            {period.mode === "month" ? t.emptyMonth : t.emptyRange}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {days.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"
                  onClick={() => onOpenDay(d.date)}
                  data-testid={`ledger-day-${d.date}`}
                >
                  <span className="font-medium">{dayLabel(d.date)}</span>
                  <span className="flex flex-wrap justify-end gap-x-3 text-sm">
                    <span>{formatCents(d.revenueCents)}</span>
                    <span className="text-muted">{fill(t.qtyUnit, { n: d.qty })}</span>
                    {d.receivableCents > 0 && (
                      <span className="font-medium text-accent-strong">
                        {t.receivable} {formatCents(d.receivableCents)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function DayView({
  date,
  data,
  error,
  onRetry,
  onBack,
  onAdd,
  onEdit,
  onRemove,
}: Readonly<{
  date: string;
  data: DayDetail | null;
  error: string | null;
  onRetry: () => void;
  /** Absent in 日 mode: the day is the period itself. */
  onBack?: () => void;
  onAdd: () => void;
  onEdit: (e: LedgerManualEntry) => void;
  onRemove: (e: LedgerManualEntry) => void;
}>) {
  return (
    <>
      {onBack ? (
        <button type="button" className="mb-1 inline-flex min-h-11 items-center text-sm text-muted" onClick={onBack}>
          {t.backToMonth}
        </button>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{dayLabel(date)}</h2>
        <button type="button" className={primaryBtn} onClick={onAdd}>
          {t.addEntry}
        </button>
      </div>
      {error ? (
        <Failed message={error} onRetry={onRetry} />
      ) : !data || data.date !== date ? (
        <p className="text-muted">{t.loading}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <AdminCard title={t.dayOrders}>
            {data.orders.length === 0 ? (
              <p className="text-muted">{t.noOrders}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {data.orders.map((o) => (
                  <li key={o.orderNo} className="py-2" data-testid={`ledger-order-${o.orderNo}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {o.orderNo} · {o.wechatId}
                      </span>
                      <span className="font-semibold">{formatCents(o.totalCents)}</span>
                    </div>
                    <div className="text-sm text-muted break-words">
                      {o.items.map((i) => fill(t.itemLine, { name: i.name, qty: i.qty })).join("、")}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
                      {o.paid ? (
                        <span>{o.method ? t.methods[o.method] : ""}</span>
                      ) : (
                        <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-ink">
                          {t.pendingTag}
                        </span>
                      )}
                      {o.deliveryFeeCents > 0 && (
                        <span className="text-muted">{fill(t.orderFee, { fee: formatCents(o.deliveryFeeCents) })}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard title={t.dayManual}>
            {data.manual.length === 0 ? (
              <p className="text-muted">{t.noManual}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {data.manual.map((m) => (
                  <li key={m.id} className="py-2" data-testid="ledger-manual-row">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium break-words">{m.note}</span>
                      <span className="font-semibold">{formatCents(m.amountCents)}</span>
                    </div>
                    <div className="text-sm text-muted">
                      {t.methods[m.paidMethod]}
                      {m.items.length > 0 &&
                        ` · ${m.items.map((i) => fill(t.itemLine, { name: i.name, qty: i.qty })).join("、")}`}
                    </div>
                    <div className="mt-1 flex gap-2">
                      <button type="button" className={secondaryBtn} onClick={() => onEdit(m)}>
                        {t.edit}
                      </button>
                      <button type="button" className={secondaryBtn} onClick={() => onRemove(m)}>
                        {t.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard>
            {data.products.length > 0 && (
              <>
                <h3 className="mb-1 text-sm font-medium text-muted">{t.dayProducts}</h3>
                <ul className="mb-3 flex flex-col gap-1 text-sm">
                  {data.products.map((p) => (
                    <li key={p.productId ?? p.name} className="flex justify-between gap-2" data-testid="ledger-product-row">
                      <span>{fill(t.productLine, { name: p.name, qty: p.qty })}</span>
                      <span>{p.amountCents > 0 ? formatCents(p.amountCents) : ""}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Totals {...data} prefix="day" />
          </AdminCard>
        </div>
      )}
    </>
  );
}

export function LedgerPage() {
  const [period, setPeriod] = useState<Period | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [rangeData, setRangeData] = useState<RangeSummary | null>(null);
  const [dayData, setDayData] = useState<DayDetail | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const productsState = useProducts();

  useEffect(() => {
    // Clock is read on the client after mount (no Date in prerender, no hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(periodFor("week", localDateOf(new Date())));
  }, []);

  // In 日 mode the day detail is the page; otherwise a day opens from the list.
  const shownDay = period?.mode === "day" ? period.from : day;

  useEffect(() => {
    if (!period || period.mode === "day") return;
    const ctrl = new AbortController();
    void (async () => {
      const r = await adminApi<RangeSummary>(`/api/admin/ledger?from=${period.from}&to=${period.to}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (r.ok) {
        setRangeData(r.data);
        setRangeError(null);
      } else if (r.error !== "UNAUTHORIZED") {
        setRangeError(r.message || t.loadFailed);
      }
    })();
    return () => ctrl.abort();
  }, [period, reloadKey]);

  useEffect(() => {
    if (!shownDay) return;
    const ctrl = new AbortController();
    void (async () => {
      const r = await adminApi<DayDetail>(`/api/admin/ledger/day?date=${shownDay}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (r.ok) {
        setDayData(r.data);
        setDayError(null);
      } else if (r.error !== "UNAUTHORIZED") {
        setDayError(r.message || t.loadFailed);
      }
    })();
    return () => ctrl.abort();
  }, [shownDay, reloadKey]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);
  const closeModal = useCallback(() => setModal(null), []);
  const products = useMemo(
    () =>
      productsState.status === "ready"
        ? productsState.products.filter((p) => p.status !== "ARCHIVED").map((p) => ({ id: p.id, name: p.name }))
        : [],
    [productsState],
  );

  if (!period) return <p className="text-muted">{t.loading}</p>;
  const today = localDateOf(new Date());
  const show = (p: Period) => {
    setRangeError(null);
    setDayError(null);
    setDay(null);
    setPeriod(p);
  };
  const inPeriod = today >= period.from && today <= period.to;
  const defaultDate = shownDay ?? (inPeriod ? today : period.from);
  const openDay = day !== null && period.mode !== "day";

  return (
    <div>
      <PageHeader
        title={t.title}
        actions={
          !openDay && (
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setModal({ kind: "form", entry: null, date: defaultDate })}
              data-testid="ledger-add"
            >
              {t.addEntry}
            </button>
          )
        }
      />

      {openDay ? null : (
        <>
          <div role="group" aria-label={t.modesLabel} className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-soft p-1">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={period.mode === m}
                className={`min-h-10 rounded-lg text-sm font-semibold ${period.mode === m ? "bg-card shadow-sm" : "text-muted"}`}
                onClick={() => show(periodFor(m, inPeriod ? today : period.from, period))}
                data-testid={`ledger-mode-${m}`}
              >
                {t.modes[m]}
              </button>
            ))}
          </div>
          {period.mode === "range" ? (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(["from", "to"] as const).map((end) => (
                <label key={end} className="flex flex-col gap-1 text-sm text-muted">
                  {t[end]}
                  <input
                    type="date"
                    className="min-h-11 rounded-lg border border-line bg-card px-3 text-base text-foreground"
                    value={period[end]}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      const next = end === "from" ? clampRange(v, period.to, "from") : clampRange(period.from, v, "to");
                      show({ mode: "range", ...next });
                    }}
                    data-testid={`ledger-range-${end}`}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div className="mb-3 flex items-center justify-between gap-2">
            <button type="button" className={navBtn} aria-label={t.prev} onClick={() => show(shiftPeriod(period, -1))}>
              ‹
            </button>
            <div className="flex flex-col items-center">
              <h2 className="text-lg font-semibold" aria-live="polite" data-testid="ledger-month-label">
                {periodLabel(period)}
              </h2>
              {!inPeriod && period.mode !== "range" ? (
                <button type="button" className="text-sm text-muted underline" onClick={() => show(periodFor(period.mode, today))}>
                  {t.today}
                </button>
              ) : null}
            </div>
            <button type="button" className={navBtn} aria-label={t.next} onClick={() => show(shiftPeriod(period, 1))}>
              ›
            </button>
          </div>
        </>
      )}

      {shownDay ? (
        <DayView
          date={shownDay}
          data={dayData}
          error={dayError}
          onRetry={reload}
          onBack={
            openDay
              ? () => {
                  setDay(null);
                  setDayData(null);
                  setDayError(null);
                }
              : undefined
          }
          onAdd={() => setModal({ kind: "form", entry: null, date: shownDay })}
          onEdit={(entry) => setModal({ kind: "form", entry, date: entry.date })}
          onRemove={(entry) => setModal({ kind: "delete", entry })}
        />
      ) : (
        <RangeView
          period={period}
          data={rangeData}
          error={rangeError}
          onRetry={reload}
          onOpenDay={(d) => {
            setDayData(null);
            setDay(d);
          }}
        />
      )}

      {modal?.kind === "form" && (
        <EntryFormSheet
          entry={modal.entry}
          defaultDate={modal.date}
          products={products}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            reload();
          }}
        />
      )}
      {modal?.kind === "delete" && (
        <DeleteSheet
          entry={modal.entry}
          onClose={closeModal}
          onDeleted={() => {
            closeModal();
            reload();
          }}
        />
      )}
    </div>
  );
}
