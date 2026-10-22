"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { CancelSection } from "./CancelSection";
import { NotFoundMessage } from "./NotFoundMessage";
import { OrderLoading } from "./OrderLoading";
import { WechatBlock } from "./WechatBlock";
import { fill, type OrderViewData } from "./types";

const t = copy.customer.order;

type LoadState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "failed" }
  | { kind: "ready"; order: OrderViewData };

export function OrderPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read ?new=1 once; the query is dropped right away so a refresh doesn't show the banner again.
  const [isNew] = useState(() => searchParams.get("new") === "1");
  const hasNewParam = searchParams.has("new");
  useEffect(() => {
    if (hasNewParam) router.replace(pathname, { scroll: false });
  }, [hasNewParam, pathname, router]);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [justCancelled, setJustCancelled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/o/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!active) return;
        if (response.status === 404) {
          setState({ kind: "notFound" });
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const order = (await response.json()) as OrderViewData;
        if (active) setState({ kind: "ready", order });
      } catch {
        // Keep showing the order we already have if a background re-fetch fails.
        if (active) setState((prev) => (prev.kind === "ready" ? prev : { kind: "failed" }));
      }
    })();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    reload();
  }, [reload]);

  if (state.kind === "loading") return <OrderLoading />;
  if (state.kind === "notFound") return <NotFoundMessage />;
  if (state.kind === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
        <p role="alert" className="text-base text-neutral-700">
          {t.loadFailed}
        </p>
        <button
          type="button"
          onClick={retry}
          className="min-h-11 rounded-lg bg-neutral-900 px-6 text-base font-medium text-white"
        >
          {t.retry}
        </button>
      </div>
    );
  }

  const { order } = state;
  const pending = order.statusKind === "PENDING";
  const finished = order.statusKind === "COMPLETED" || order.statusKind === "CANCELLED";
  const showCancel = order.canCancel || !finished;

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      {isNew && (
        <section data-testid="new-banner" className="rounded-xl bg-amber-100 p-4 text-amber-950">
          <p className="text-lg font-semibold">{t.newTitle}</p>
          <p className="mt-1 text-sm leading-relaxed">{t.newHint}</p>
        </section>
      )}

      {justCancelled && (
        <p role="status" className="rounded-xl bg-neutral-200 p-3 text-center text-base font-medium">
          {t.cancelled}
        </p>
      )}

      <h1 data-testid="status-text" className="break-words text-2xl font-bold leading-snug">
        {order.statusText}
      </h1>

      {order.ownerWechatId && <WechatBlock ownerWechatId={order.ownerWechatId} prominent={pending} />}

      <section className="flex flex-col gap-1 rounded-xl bg-white p-4 text-base shadow-sm">
        <p className="text-sm text-neutral-500">{fill(t.orderNo, { orderNo: order.orderNo })}</p>
        <p className="font-medium">{fill(t.pickupDate, { pickupDateLabel: order.pickupDateLabel })}</p>
        <p>{order.fulfillment === "DELIVERY" ? t.delivery : t.pickup}</p>
        {order.fulfillment === "PICKUP" && order.pickupNote && (
          <p className="text-sm text-neutral-600">{order.pickupNote}</p>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm text-neutral-500">{t.itemsTitle}</h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 text-base">
              <span className="min-w-0 break-words">{fill(t.itemLine, { name: item.name, qty: item.qty })}</span>
              <span className="shrink-0 tabular-nums">{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-neutral-200 pt-3 text-base">
          <div className="flex justify-between">
            <dt className="text-neutral-600">{t.subtotal}</dt>
            <dd className="tabular-nums">{formatCents(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600">{t.deliveryFee}</dt>
            <dd className="tabular-nums">{formatCents(order.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <dt>{t.total}</dt>
            <dd data-testid="total" className="tabular-nums">
              {formatCents(order.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      {order.note && (
        <p className="break-words rounded-xl bg-white p-4 text-sm text-neutral-700 shadow-sm">
          {fill(t.note, { note: order.note })}
        </p>
      )}

      <p className="text-center text-sm text-neutral-600">{t.payOnReceipt}</p>

      {showCancel && (
        <CancelSection
          token={token}
          canCancel={order.canCancel}
          cancelDeadlineLabel={order.cancelDeadlineLabel}
          onCancelled={() => {
            setJustCancelled(true);
            reload();
          }}
          onRefused={reload}
        />
      )}

      <footer className="pt-4 text-center text-xs text-neutral-400">{copy.shopName}</footer>
    </div>
  );
}
