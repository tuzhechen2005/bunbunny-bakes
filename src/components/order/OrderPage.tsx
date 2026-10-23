"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { useMotionPrefs } from "@/lib/motion/react";
import { CancelSection } from "./CancelSection";
import { NotFoundMessage } from "./NotFoundMessage";
import { OrderLoading } from "./OrderLoading";
import { OrderLinkCopy } from "./OrderLinkCopy";
import { OrderStage } from "./OrderStage";
import { WechatBlock } from "./WechatBlock";
import { fill, type OrderViewData } from "./types";

const t = copy.customer.order;
const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";
/** Stagger index of a title / card that rises after the stamp. */
const rest = (i: number): CSSProperties => ({ ["--i" as string]: i });

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

  // The sequence (?new=1, full motion): the title and cards wait for the stamp impact.
  const { reduced } = useMotionPrefs();
  const [stamped, setStamped] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);
  const onImpact = useCallback(() => setStamped(true), []);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** Set when the order on screen is known to be out of date (a cancel just succeeded). */
  const staleAfterCancel = useRef(false);
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
        // A background re-fetch failure keeps the order on screen, except right after a
        // cancel: then the shown order is known to be stale, so offer a retry instead.
        if (!active) return;
        const keepStale = !staleAfterCancel.current;
        setState((prev) => (keepStale && prev.kind === "ready" ? prev : { kind: "failed" }));
      } finally {
        if (active) staleAfterCancel.current = false;
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
        <p role="alert" className="text-base font-semibold text-c-ink">
          {t.loadFailed}
        </p>
        <button
          type="button"
          onClick={retry}
          className={`min-h-11 rounded-full border-[1.5px] border-c-ink px-6 text-base font-bold text-c-ink ${focusRing}`}
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
  const showFee = order.fulfillment === "DELIVERY" || order.deliveryFeeCents > 0;
  const seq = isNew && !reduced ? (stamped ? "show" : "hide") : undefined;

  return (
    <div
      ref={columnRef}
      data-seq={seq}
      className="flex flex-col overflow-x-clip px-5 pb-[calc(30px+env(safe-area-inset-bottom))]"
    >
      {justCancelled && (
        <p role="status" className="mt-5 rounded-2xl bg-c-paper p-3 text-center text-[15px] font-bold">
          {t.cancelled}
        </p>
      )}

      <OrderStage order={order} fresh={isNew} shakeRef={columnRef} onImpact={onImpact} />

      {isNew && (
        <div data-rest="" style={rest(0)}>
          <h2 data-testid="new-title" className="m-0 text-center font-display text-[32px] leading-[1.15] tracking-[-0.045em]">
            {t.newTitle}
          </h2>
          <p className="mt-2.5 text-center text-[15px] leading-normal font-medium text-c-grey">
            {copy.customer.brand.receiptLast}
          </p>
        </div>
      )}

      <h1
        data-testid="status-text"
        data-rest=""
        style={rest(1)}
        className={`break-words text-center font-display ${
          isNew ? "mt-4 text-[17px] leading-snug tracking-[-0.02em]" : "m-0 text-[26px] leading-[1.25] tracking-[-0.04em]"
        }`}
      >
        {order.statusText}
      </h1>

      <section data-testid="order-card" data-rest="" style={rest(2)} className="mt-[26px] rounded-[24px] bg-c-paper p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-dashed border-c-line pb-3.5">
          <span
            data-testid="order-no"
            aria-label={fill(t.orderNo, { orderNo: order.orderNo })}
            className="whitespace-nowrap font-num text-[34px] leading-none font-bold tracking-[-0.01em]"
          >
            {order.orderNo}
          </span>
          <b className="ml-auto shrink-0 text-right text-base leading-tight font-bold">
            <span>{order.pickupDateLabel}</span>
            <span aria-hidden="true"> · </span>
            <span>{order.fulfillment === "DELIVERY" ? t.delivery : t.pickup}</span>
          </b>
        </div>
        {order.fulfillment === "PICKUP" && order.pickupNote && (
          <p className="mb-2 break-words text-[13px] leading-normal text-c-grey">{order.pickupNote}</p>
        )}
        <ul className="m-0 list-none p-0">
          {order.items.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-[14.5px] leading-8">
              <span className="min-w-0 break-words text-c-grey">{fill(t.itemLine, { name: item.name, qty: item.qty })}</span>
              <span className="shrink-0 font-num font-bold tabular-nums">{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <div className="my-2 border-t border-dashed border-c-line" />
        {showFee && (
          <div className="flex items-baseline justify-between text-[14.5px] leading-8">
            <span className="text-c-grey">{t.deliveryFee}</span>
            <span className="font-num font-bold tabular-nums">{formatCents(order.deliveryFeeCents)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between font-black">
          <span className="text-[14.5px] leading-8">{t.total}</span>
          <span data-testid="total" className="font-num text-2xl font-bold tabular-nums">
            {formatCents(order.totalCents)}
          </span>
        </div>
        {order.note && (
          <p className="mt-1 break-words text-[14.5px] leading-8 text-c-grey">{fill(t.note, { note: order.note })}</p>
        )}
        <p className="mt-2 text-[13px] leading-normal text-c-grey">{t.payOnReceipt}</p>
      </section>

      <section data-rest="" style={rest(3)} className="mt-[18px] rounded-[24px] bg-c-paper p-5">
        {isNew ? (
          <div data-testid="new-banner">
            <p className="mb-3 text-sm leading-relaxed font-medium">{t.newHint}</p>
            <OrderLinkCopy token={token} variant="banner" />
          </div>
        ) : (
          <OrderLinkCopy token={token} variant="secondary" />
        )}
        {order.ownerWechatId && <WechatBlock ownerWechatId={order.ownerWechatId} prominent={pending} />}
      </section>

      {showCancel && (
        <div data-rest="" style={rest(4)} className="mt-[22px]">
          <CancelSection
            token={token}
            canCancel={order.canCancel}
            cancelDeadlineLabel={order.cancelDeadlineLabel}
            onCancelled={() => {
              setJustCancelled(true);
              staleAfterCancel.current = true;
              reload();
            }}
            onRefused={reload}
          />
        </div>
      )}

      <Link
        href="/"
        data-rest=""
        style={rest(5)}
        className={`mx-auto mt-1.5 flex min-h-11 items-center px-4 text-sm font-bold text-c-grey ${focusRing}`}
      >
        {t.backHome}
      </Link>
    </div>
  );
}
