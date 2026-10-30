"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { copy } from "@/copy";
import { addDays } from "@/domain/dates";
import type { OrderStatus } from "@/domain/types";
import { adminApi } from "@/lib/adminApi";
import type { OrderList, OrderRow } from "@/server/orderQueries";
import {
  CopyButton,
  inputClass,
  money,
  secondaryBtn,
  primaryBtn,
  STATUS_ORDER,
  StatusChip,
} from "./shared";
import { moveToLabel } from "./statusUi";

const t = copy.admin.orders;

/** Early enough to include every past order (the default range starts today). */
const LONG_AGO = "2020-01-01";

interface Filters {
  date: string;
  from: string;
  status: OrderStatus[];
  fulfillment: string;
  paid: string;
  productId: string;
  q: string;
}

function readFilters(sp: URLSearchParams): Filters {
  return {
    date: sp.get("date") ?? "",
    from: sp.get("from") ?? "",
    status: sp.getAll("status").filter((s): s is OrderStatus => (STATUS_ORDER as string[]).includes(s)),
    fulfillment: sp.get("fulfillment") ?? "",
    paid: sp.get("paid") ?? "",
    productId: sp.get("productId") ?? "",
    q: sp.get("q") ?? "",
  };
}

function toQuery(f: Filters, cursor?: string | null): string {
  const p = new URLSearchParams();
  if (f.date) p.set("date", f.date);
  else if (f.from) p.set("from", f.from);
  for (const s of f.status) p.append("status", s);
  if (f.fulfillment) p.set("fulfillment", f.fulfillment);
  if (f.paid) p.set("paid", f.paid);
  if (f.productId) p.set("productId", f.productId);
  if (f.q) p.set("q", f.q);
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

const chip = (on: boolean) =>
  `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
    on ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-foreground"
  }`;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function OrdersListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = readFilters(new URLSearchParams(searchParams.toString()));
  const queryKey = toQuery(filters);

  const [data, setData] = useState<OrderList | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const reqId = useRef(0);

  async function load() {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const res = await adminApi<OrderList>(`/api/admin/orders?${queryKey}`);
    if (id !== reqId.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setData(res.data);
    setOrders(res.data.orders);
    setCursor(res.data.nextCursor);
  }

  useEffect(() => {
    // Fetching on filter change is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  function setFilters(next: Filters) {
    const qs = toQuery(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const id = reqId.current;
    setLoadingMore(true);
    const res = await adminApi<OrderList>(`/api/admin/orders?${toQuery(filters, cursor)}`);
    setLoadingMore(false);
    if (id !== reqId.current) return;
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setOrders((prev) => [...prev, ...res.data.orders]);
    setCursor(res.data.nextCursor);
  }

  async function advance(order: OrderRow, to: OrderStatus) {
    if (busyRow) return;
    setBusyRow(order.id);
    setRowError((e) => ({ ...e, [order.id]: "" }));
    const res = await adminApi(`/api/admin/orders/${order.id}/status`, {
      body: { to, expectedUpdatedAt: order.updatedAt },
    });
    setBusyRow(null);
    if (!res.ok) {
      setRowError((e) => ({ ...e, [order.id]: res.error === "STALE" ? copy.errors.STALE : res.message }));
      if (res.error === "STALE") await load();
      return;
    }
    await load();
  }

  const today = data?.today ?? null;
  const tomorrow = today ? addDays(today, 1) : null;
  const unconfirmedOn = sameSet(filters.status, ["NEW", "CONTACTED"]);
  const tomorrowOn = !!tomorrow && filters.date === tomorrow;
  const doneUnpaidOn = sameSet(filters.status, ["COMPLETED"]) && filters.paid === "false";
  const hasFilters = !!(
    filters.date || filters.from || filters.status.length || filters.fulfillment || filters.paid || filters.productId || filters.q
  );
  const empty: Filters = { date: "", from: "", status: [], fulfillment: "", paid: "", productId: "", q: "" };

  return (
    <>
      <PageHeader title={t.listTitle} />

      <SearchForm key={filters.q} initial={filters.q} onSearch={(q) => setFilters({ ...filters, q })} />

      <div className="mb-3 flex flex-wrap gap-2" aria-label={t.quickTitle}>
        <button
          type="button"
          aria-pressed={unconfirmedOn}
          className={chip(unconfirmedOn)}
          onClick={() =>
            setFilters(unconfirmedOn ? empty : { ...empty, status: ["NEW", "CONTACTED"] })
          }
        >
          {t.quickUnconfirmed}
        </button>
        <button
          type="button"
          aria-pressed={tomorrowOn}
          disabled={!tomorrow}
          className={chip(tomorrowOn)}
          onClick={() => tomorrow && setFilters(tomorrowOn ? empty : { ...empty, date: tomorrow })}
        >
          {t.quickTomorrow}
        </button>
        <button
          type="button"
          aria-pressed={doneUnpaidOn}
          className={chip(doneUnpaidOn)}
          onClick={() =>
            setFilters(doneUnpaidOn ? empty : { ...empty, from: LONG_AGO, status: ["COMPLETED"], paid: "false" })
          }
        >
          {t.quickDoneUnpaid}
        </button>
        <button type="button" className={chip(showFilters)} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
          {t.filters}
        </button>
      </div>

      {showFilters && (
        <div className="mb-4 space-y-3 rounded-xl border border-line bg-card p-3">
          <div className="block text-sm">
            <label htmlFor="orders-date">{t.dateLabel}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" aria-pressed={!filters.date && !filters.from} className={chip(!filters.date && !filters.from)} onClick={() => setFilters({ ...filters, date: "", from: "" })}>
                {t.upcomingDates}
              </button>
              <button type="button" aria-pressed={filters.date === "all"} className={chip(filters.date === "all")} onClick={() => setFilters({ ...filters, date: "all", from: "" })}>
                {t.allDates}
              </button>
            </div>
            <div className="mt-1 flex gap-2">
              <input
                id="orders-date"
                type="date"
                value={filters.date === "all" ? "" : filters.date}
                onChange={(e) => setFilters({ ...filters, date: e.target.value, from: "" })}
                className={inputClass}
              />
              {filters.date && filters.date !== "all" && (
                <button type="button" className={secondaryBtn} onClick={() => setFilters({ ...filters, date: "" })}>
                  {t.clearDate}
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm">{t.statusTitle}</div>
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => {
                const on = filters.status.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    className={chip(on)}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        status: on ? filters.status.filter((x) => x !== s) : [...filters.status, s],
                      })
                    }
                  >
                    {t.statusLabels[s]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm">{t.fulfillmentTitle}</div>
            <div className="flex flex-wrap gap-2">
              {[
                ["", t.all],
                ["PICKUP", t.pickup],
                ["DELIVERY", t.delivery],
              ].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={filters.fulfillment === v} className={chip(filters.fulfillment === v)} onClick={() => setFilters({ ...filters, fulfillment: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm">{t.paidTitle}</div>
            <div className="flex flex-wrap gap-2">
              {[
                ["", t.all],
                ["true", t.paid],
                ["false", t.unpaid],
              ].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={filters.paid === v} className={chip(filters.paid === v)} onClick={() => setFilters({ ...filters, paid: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            {t.productLabel}
            <select
              className={`${inputClass} mt-1`}
              value={filters.productId}
              onChange={(e) => setFilters({ ...filters, productId: e.target.value })}
            >
              <option value="">{t.allProducts}</option>
              {data?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {hasFilters && (
        <button type="button" className="mb-3 min-h-11 text-sm text-muted underline" onClick={() => setFilters(empty)}>
          {t.clearFilters}
        </button>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-danger p-3 text-danger">
          {error}{" "}
          <button type="button" className="min-h-11 underline" onClick={() => void load()}>
            {t.retry}
          </button>
        </div>
      )}

      {loading && orders.length === 0 && <p className="py-8 text-center text-muted">{t.loading}</p>}
      {!loading && !error && orders.length === 0 && <p className="py-8 text-center text-muted">{t.empty}</p>}

      <ul className="space-y-3">
        {orders.map((o) => {
          const next = o.nextStatuses.find((n) => n.to !== "CANCELLED" && n.to !== "REJECTED");
          return (
            <li key={o.id} data-testid="order-row" className="rounded-xl border border-line bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/orders/${o.id}`} className="flex min-h-11 flex-col justify-center">
                  <span className="text-lg font-semibold">{o.orderNo}</span>
                  <span className="text-sm text-muted">{o.pickupDateLabel}</span>
                </Link>
                <div className="flex flex-col items-end gap-1">
                  <StatusChip status={o.status} fulfillment={o.fulfillment} />
                  <span className={`text-sm ${o.paid ? "text-foreground" : "text-muted"}`}>
                    {o.paid ? t.paidMark : t.unpaidMark}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all text-base">{o.wechatId}</span>
                <CopyButton text={o.wechatId} label={t.copyWechat} />
              </div>
              <p className="mt-1 text-base">{o.itemsSummary}</p>
              <p className="mt-1 text-sm text-muted">
                {money(o.totalCents)} · {o.fulfillment === "DELIVERY" ? t.delivery : t.pickup}
              </p>
              {next && (
                <button
                  type="button"
                  disabled={busyRow === o.id}
                  className={`${primaryBtn} mt-2 w-full`}
                  onClick={() => void advance(o, next.to)}
                >
                  {busyRow === o.id ? t.working : moveToLabel(next.to as OrderStatus, o.fulfillment)}
                </button>
              )}
              {rowError[o.id] && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {rowError[o.id]}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {cursor && (
        <button type="button" disabled={loadingMore} className={`${secondaryBtn} mt-4 w-full`} onClick={() => void loadMore()}>
          {loadingMore ? t.loadingMore : t.loadMore}
        </button>
      )}
    </>
  );
}

function SearchForm({ initial, onSearch }: Readonly<{ initial: string; onSearch: (q: string) => void }>) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="mb-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value.trim());
      }}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t.searchPlaceholder}
        aria-label={t.searchPlaceholder}
        className={inputClass}
      />
      <button type="submit" className={`${secondaryBtn} shrink-0 whitespace-nowrap`}>
        {t.search}
      </button>
    </form>
  );
}
