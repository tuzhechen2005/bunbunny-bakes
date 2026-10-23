"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { fetchMenu } from "@/lib/api";
import { myOrders, type MyOrderEntry } from "@/lib/myOrders";
import type { OrderViewData } from "@/components/order/types";
import { fill } from "./format";

const t = copy.customer.myOrders;
const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";

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
        className="mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip bg-c-paper px-5 pb-[calc(30px+env(safe-area-inset-bottom))]"
      >
        <header className="flex min-h-14 items-center justify-between pt-3">
          <h1 className="m-0 font-display text-[32px] leading-[1.15] tracking-[-0.045em]">{t.pageTitle}</h1>
          <Link
            href="/"
            data-testid="orders-home"
            className={`-mr-3 flex min-h-11 items-center px-3 text-sm font-bold text-c-grey ${focusRing}`}
          >
            {t.backHome}
          </Link>
        </header>

        {entries === null ? (
          <p role="status" className="mt-10 text-center text-[15px] text-c-grey">
            {t.loading}
          </p>
        ) : entries.length === 0 ? (
          <p data-testid="orders-empty" className="mt-16 mb-10 text-center font-display text-xl text-c-grey">
            {t.empty}
          </p>
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
        <p data-testid="row-date" className="mt-2 text-[14px] leading-snug font-bold">
          {order.pickupDateLabel}
        </p>
        <p data-testid="row-status" className="mt-1 break-words text-[13.5px] leading-snug text-c-grey">
          {order.statusText}
        </p>
      </Link>
    </li>
  );
}
