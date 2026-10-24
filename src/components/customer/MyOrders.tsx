"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { fetchMenu } from "@/lib/api";
import { myOrders, type MyOrderEntry } from "@/lib/myOrders";
import type { OrderViewData } from "@/components/order/types";
import { fill } from "./format";

const t = copy.customer.myOrders;

/** The short status of a row (the order page has the full sentence). */
function shortStatus(order: Pick<OrderViewData, "statusKind" | "fulfillment">): string {
  if (order.statusKind === "READY" && order.fulfillment === "DELIVERY") return t.status.READY_DELIVERY;
  return t.status[order.statusKind];
}

type RowState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; order: OrderViewData };

/** The orders opened on this phone (D84), each checked live against GET /api/o/{token}. */
export function MyOrders() {
  // null until the client has read localStorage (the server renders no list).
  const [entries, setEntries] = useState<MyOrderEntry[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [ownerWechatId, setOwnerWechatId] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (token: string) => {
    setRows((r) => ({ ...r, [token]: { kind: "loading" } }));
    try {
      const response = await fetch(`/api/o/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!alive.current) return;
      if (response.status === 404) {
        // The order is gone: forget it.
        myOrders.remove(token);
        setEntries((list) => list?.filter((e) => e.token !== token) ?? list);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const order = (await response.json()) as OrderViewData;
      if (alive.current) setRows((r) => ({ ...r, [token]: { kind: "ready", order } }));
    } catch {
      if (alive.current) setRows((r) => ({ ...r, [token]: { kind: "failed" } }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const list = myOrders.list();
    // Reading the browser-only store once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(list);
    for (const e of list) void load(e.token);
    void fetchMenu().then((result) => {
      if (alive.current && result.ok && result.data.ownerWechatId) setOwnerWechatId(result.data.ownerWechatId);
    });
    return () => {
      alive.current = false;
    };
  }, [load]);

  return (
    <div className="flex flex-1 flex-col bg-c-wash text-c-ink">
      <main
        data-testid="my-orders"
        className="mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip bg-c-paper pb-[calc(30px+env(safe-area-inset-bottom))]"
      >
        <TopBar backHref="/" backLabel={copy.customer.brand.back} title={t.pageTitle} titleAs="h1" />
        <div className="flex flex-1 flex-col px-5">
          {entries === null ? (
            <p role="status" className="mt-10 text-center text-[15px] text-c-grey">
              {t.loading}
            </p>
          ) : entries.length === 0 ? (
            <div data-testid="orders-empty" className="mt-16 mb-10 flex flex-col items-center gap-4 text-center">
              <Logo className="h-20 w-auto opacity-40" />
              <p className="m-0 font-display text-xl text-c-grey">{t.empty}</p>
            </div>
          ) : (
            <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
              {entries.map((entry) => (
                <OrderRow key={entry.token} entry={entry} state={rows[entry.token] ?? { kind: "loading" }} onRetry={load} />
              ))}
            </ul>
          )}

          <p data-testid="orders-hint" className="mt-8 text-center text-[13px] leading-normal text-c-grey">
            {ownerWechatId ? fill(t.footerHintWithId, { id: ownerWechatId }) : t.footerHint}
          </p>
        </div>
      </main>
    </div>
  );
}

function OrderRow({
  entry,
  state,
  onRetry,
}: {
  entry: MyOrderEntry;
  state: RowState;
  onRetry: (token: string) => void;
}) {
  const href = `/o/${encodeURIComponent(entry.token)}`;
  const base = "rounded-[20px] bg-c-wash p-4";

  if (state.kind === "failed") {
    return (
      <li data-testid="order-row" data-state="failed" className={`${base} flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <Link href={href} className={`font-num text-[22px] leading-none font-bold ${focusRing}`}>
            {entry.orderNo}
          </Link>
          <p role="alert" className="mt-1.5 text-[13px] text-c-grey">
            {t.rowFailed}
          </p>
        </div>
        <button
          type="button"
          data-testid="order-row-retry"
          onClick={() => onRetry(entry.token)}
          className={`min-h-11 shrink-0 rounded-full border-[1.5px] border-c-ink px-4 text-sm font-bold text-c-ink ${focusRing}`}
        >
          {t.retry}
        </button>
      </li>
    );
  }

  if (state.kind === "loading") {
    return (
      <li data-testid="order-row" data-state="loading" className={`${base} min-h-[84px]`} aria-busy="true">
        <span className="font-num text-[22px] leading-none font-bold">{entry.orderNo}</span>
      </li>
    );
  }

  const { order } = state;
  return (
    <li data-testid="order-row" data-state="ready" className="list-none">
      <Link
        href={href}
        className={`block min-h-11 ${base} transition-transform active:scale-[0.99] ${focusRing}`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span data-testid="row-order-no" className="font-num text-[22px] leading-none font-bold">
            {order.orderNo}
          </span>
          <span data-testid="row-total" className="shrink-0 font-num text-xl leading-none font-bold tabular-nums">
            {formatCents(order.totalCents)}
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p data-testid="row-date" className="m-0 min-w-0 text-[14px] leading-snug font-bold">
            {order.pickupDateLabel}
          </p>
          <span
            data-testid="row-status"
            className="shrink-0 rounded-full bg-c-paper px-3 py-1 text-[13px] leading-snug font-bold text-c-ink"
          >
            {shortStatus(order)}
          </span>
        </div>
      </Link>
    </li>
  );
}
