"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { inputClass, primaryBtn, secondaryBtn } from "@/components/admin/orders/shared";
import { useProducts } from "@/components/admin/products/useProducts";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { cutoffAt } from "@/domain/cutoff";
import { dayLabel, localDateOf } from "@/domain/dates";
import { shiftRange } from "@/domain/ledger";
import { adminApi } from "@/lib/adminApi";

const t = copy.admin.pools;
/** The next three weeks: pools and stock further out are not worth a row yet. */
const DAYS = 21;

type PoolStatus = "OPEN" | "FORMED" | "CONFIRMED" | "FAILED";
interface AdminPool {
  date: string;
  productId: string;
  flavorId: string | null;
  decision: "OPEN" | "CONFIRMED" | "FAILED" | null;
  minOverride: number | null;
  pieces: number;
  min: number;
  cakes: number;
  last: number;
  spare: number;
  status: PoolStatus;
  needMore: number;
  orderCount: number;
}
interface AdminLot {
  lotId: string;
  date: string;
  productId: string;
  flavorId: string | null;
  qty: number;
  sold: number;
  left: number;
  sellUntil: string;
  closed: boolean;
  note?: string | null;
}

const chicagoTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Chicago", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

const statusClass: Record<PoolStatus, string> = {
  OPEN: "bg-soft text-muted",
  FORMED: "bg-accent text-accent-ink",
  CONFIRMED: "bg-accent text-accent-ink",
  FAILED: "bg-danger/10 text-danger",
};

/**
 * D192/D194 拼单和现货: one row per pool for the next three weeks ("原味巴斯克｜已拼 4 块｜计划 1 只（6 块）｜预计剩 2 块"),
 * with the owner's decisions; then the stock lots with their own add / adjust / stop.
 */
export function PoolsPage() {
  const productsState = useProducts();
  const [pools, setPools] = useState<AdminPool[] | null>(null);
  const [lots, setLots] = useState<AdminLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [minEdit, setMinEdit] = useState<Record<string, string>>({});
  const [qtyEdit, setQtyEdit] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ date: "", productId: "", flavorId: "", qty: "", until: "12:00" });

  useEffect(() => {
    const today = localDateOf(new Date());
    // Clock read after mount (no Date in prerender).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRange({ from: today, to: shiftRange(today, today, DAYS - 1).to });
  }, []);

  useEffect(() => {
    if (!range) return;
    const ctrl = new AbortController();
    void (async () => {
      const q = `from=${range.from}&to=${range.to}`;
      const [p, l] = await Promise.all([
        adminApi<{ pools: AdminPool[] }>(`/api/admin/group-pools?${q}`, { signal: ctrl.signal }),
        adminApi<{ lots: AdminLot[] }>(`/api/admin/stock-lots?${q}`, { signal: ctrl.signal }),
      ]);
      if (ctrl.signal.aborted) return;
      if (p.ok) setPools(p.data.pools);
      if (l.ok) setLots(l.data.lots);
      if (!p.ok && p.error !== "UNAUTHORIZED") setError(p.message || t.loadFailed);
      else if (!l.ok && l.error !== "UNAUTHORIZED") setError(l.message || t.loadFailed);
    })();
    return () => ctrl.abort();
  }, [range, reloadKey]);

  const products = useMemo(() => (productsState.status === "ready" ? productsState.products : []), [productsState]);
  const nameOf = useCallback(
    (productId: string, flavorId: string | null) => {
      const p = products.find((x) => x.id === productId);
      if (!p) return "";
      const f = flavorId ? p.flavors?.find((x) => x.id === flavorId) : null;
      return f ? `${f.name}${p.name}` : p.name;
    },
    [products],
  );

  const act = async (path: string, method: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const r = await adminApi(path, { method, body });
    setBusy(false);
    if (!r.ok) {
      setError(r.message || t.failed);
      return false;
    }
    setReloadKey((n) => n + 1);
    return true;
  };
  const decide = (p: AdminPool, action: "confirm" | "fail" | "reopen" | "minimum", minOverride?: number | null) =>
    act("/api/admin/group-pools", "POST", { date: p.date, productId: p.productId, flavorId: p.flavorId, action, ...(action === "minimum" ? { minOverride } : {}) });
  const keyOf = (p: { date: string; productId: string; flavorId: string | null }) => `${p.date}|${p.productId}|${p.flavorId ?? ""}`;

  const byDate = useMemo(() => {
    const m = new Map<string, AdminPool[]>();
    for (const p of pools ?? []) if (p.pieces > 0 || p.decision) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  }, [pools]);

  const draftProduct = products.find((p) => p.id === draft.productId);
  const addLot = async () => {
    const qty = Number(draft.qty);
    if (!draft.date || !draft.productId || !Number.isInteger(qty) || qty < 1) {
      setError(t.invalid);
      return;
    }
    if ((draftProduct?.flavors?.filter((f) => f.active).length ?? 0) > 0 && !draft.flavorId) {
      setError(t.pickFlavor);
      return;
    }
    // "HH:MM" on that date in Chicago, as the instant the server expects.
    const ok = await act("/api/admin/stock-lots", "POST", {
      date: draft.date,
      productId: draft.productId,
      flavorId: draft.flavorId || null,
      qty,
      sellUntil: cutoffAt(draft.date, 0, draft.until || "12:00").toISOString(),
    });
    if (ok) setDraft({ ...draft, qty: "" });
  };

  return (
    <div>
      <PageHeader title={t.title} />
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <AdminCard title={t.poolsTitle} className="mb-4">
        {pools === null ? (
          <p className="text-muted">{t.loading}</p>
        ) : byDate.length === 0 ? (
          <p className="text-muted" data-testid="pools-empty">
            {t.noPools}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {byDate.map(([date, list]) => (
              <section key={date}>
                <h3 className="mb-1 font-semibold">{dayLabel(date)}</h3>
                <ul className="flex flex-col divide-y divide-line">
                  {list.map((p) => {
                    const k = keyOf(p);
                    return (
                      <li key={k} className="py-2" data-testid="pool-row">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">
                            {nameOf(p.productId, p.flavorId)}｜{fill(t.line, { pieces: p.pieces, cakes: p.cakes, made: p.cakes * (products.find((x) => x.id === p.productId)?.batchYield ?? 0), spare: p.spare })}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${statusClass[p.status]}`} data-testid="pool-status">
                            {t.status[p.status]}
                            {p.status === "OPEN" && p.needMore > 0 ? ` · ${fill(t.needMore, { n: p.needMore })}` : ""}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {p.status !== "CONFIRMED" ? (
                            <button type="button" disabled={busy} className={primaryBtn} onClick={() => void decide(p, "confirm")} data-testid="pool-confirm">
                              {t.confirm}
                            </button>
                          ) : null}
                          {p.status !== "FAILED" ? (
                            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void decide(p, "fail")} data-testid="pool-fail">
                              {t.fail}
                            </button>
                          ) : null}
                          {p.decision && p.decision !== "OPEN" ? (
                            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void decide(p, "reopen")}>
                              {t.reopen}
                            </button>
                          ) : null}
                          {p.spare > 0 && (p.status === "FORMED" || p.status === "CONFIRMED") ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={secondaryBtn}
                              onClick={() => void act("/api/admin/group-pools/convert-spare", "POST", { date: p.date, productId: p.productId, flavorId: p.flavorId })}
                              data-testid="pool-convert"
                            >
                              {fill(t.convert, { n: p.spare })}
                            </button>
                          ) : null}
                          <label className="flex items-center gap-1 text-sm text-muted">
                            {t.min}
                            <input
                              inputMode="numeric"
                              className="h-10 w-14 rounded-lg border border-line bg-card px-2 text-base text-foreground"
                              value={minEdit[k] ?? String(p.min)}
                              onChange={(e) => setMinEdit({ ...minEdit, [k]: e.target.value })}
                              onBlur={() => {
                                const v = minEdit[k];
                                if (v === undefined || v === String(p.min)) return;
                                const n = v.trim() === "" ? null : Number(v);
                                if (n !== null && (!Number.isInteger(n) || n < 1)) return setError(t.invalid);
                                void decide(p, "minimum", n).then(() => setMinEdit(({ [k]: _drop, ...rest }) => rest));
                              }}
                              data-testid="pool-min"
                            />
                          </label>
                          <a className="text-sm text-muted underline" href={`/admin/orders?date=${p.date}`}>
                            {fill(t.orders, { n: p.orderCount })}
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </AdminCard>

      <AdminCard title={t.stockTitle}>
        {lots === null ? (
          <p className="text-muted">{t.loading}</p>
        ) : lots.length === 0 ? (
          <p className="text-muted">{t.noStock}</p>
        ) : (
          <ul className="mb-3 flex flex-col divide-y divide-line">
            {lots.map((l) => (
              <li key={l.lotId} className={`py-2 ${l.closed ? "opacity-60" : ""}`} data-testid="stock-row">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {dayLabel(l.date)}｜{nameOf(l.productId, l.flavorId)}
                  </span>
                  <span className="text-sm">
                    {l.closed ? t.closed : fill(t.left, { left: l.left, qty: l.qty })} · {fill(t.until, { time: chicagoTime(l.sellUntil) })}
                  </span>
                </div>
                {!l.closed ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-sm text-muted">
                      {t.qty}
                      <input
                        inputMode="numeric"
                        className="h-10 w-16 rounded-lg border border-line bg-card px-2 text-base text-foreground"
                        value={qtyEdit[l.lotId] ?? String(l.qty)}
                        onChange={(e) => setQtyEdit({ ...qtyEdit, [l.lotId]: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || qtyEdit[l.lotId] === undefined}
                      className={secondaryBtn}
                      onClick={() => {
                        const n = Number(qtyEdit[l.lotId]);
                        if (!Number.isInteger(n) || n < l.sold) return setError(fill(t.qtyTooLow, { sold: l.sold }));
                        void act(`/api/admin/stock-lots/${l.lotId}`, "PATCH", { qty: n }).then(() => setQtyEdit(({ [l.lotId]: _drop, ...rest }) => rest));
                      }}
                    >
                      {t.save}
                    </button>
                    <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void act(`/api/admin/stock-lots/${l.lotId}`, "PATCH", { closed: true })} data-testid="stock-close">
                      {t.soldOut}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-2 mb-2 text-sm font-medium text-muted">{t.addStock}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <input type="date" aria-label={t.date} className={inputClass} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} data-testid="stock-date" />
          <select aria-label={t.product} className={inputClass} value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value, flavorId: "" })} data-testid="stock-product">
            <option value="">{t.product}</option>
            {products.filter((p) => p.status !== "ARCHIVED").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {(draftProduct?.flavors?.filter((f) => f.active).length ?? 0) > 0 ? (
            <select aria-label={t.flavor} className={inputClass} value={draft.flavorId} onChange={(e) => setDraft({ ...draft, flavorId: e.target.value })} data-testid="stock-flavor">
              <option value="">{t.flavor}</option>
              {draftProduct!.flavors!.filter((f) => f.active).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : null}
          <input inputMode="numeric" aria-label={t.qty} placeholder={t.qty} className={inputClass} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} data-testid="stock-qty" />
          <label className="flex items-center gap-1 text-sm text-muted">
            {t.untilLabel}
            <input type="time" className={inputClass} value={draft.until} onChange={(e) => setDraft({ ...draft, until: e.target.value })} data-testid="stock-until" />
          </label>
        </div>
        <button type="button" disabled={busy} className={`${primaryBtn} mt-3`} onClick={() => void addLot()} data-testid="stock-add">
          {t.addStock}
        </button>
      </AdminCard>
    </div>
  );
}
