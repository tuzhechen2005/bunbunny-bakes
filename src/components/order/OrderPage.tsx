"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "@/copy";
import { CancelSection } from "./CancelSection";
import { NotFoundMessage } from "./NotFoundMessage";
import { OrderLoading } from "./OrderLoading";
import { OrderLinkCopy } from "./OrderLinkCopy";
import { Receipt } from "./Receipt";
import { WechatBlock } from "./WechatBlock";
import { type OrderViewData } from "./types";

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
        <p role="alert" className="text-base text-ink">
          {t.loadFailed}
        </p>
        <button
          type="button"
          onClick={retry}
          className="min-h-11 rounded-full bg-accent px-6 text-base font-semibold text-accent-ink active:bg-accent-strong"
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
    <div className="flex flex-col gap-4 overflow-x-clip px-4 py-6">
      {justCancelled && (
        <p role="status" className="rounded-xl bg-soft p-3 text-center text-base font-medium">
          {t.cancelled}
        </p>
      )}

      <h1 data-testid="status-text" className="break-words font-serif text-2xl leading-snug">
        {order.statusText}
      </h1>

      {order.ownerWechatId && <WechatBlock ownerWechatId={order.ownerWechatId} prominent={pending} />}

      <Receipt order={order} fresh={isNew} />

      {isNew && (
        <section data-testid="new-banner" className="rounded-2xl bg-caramel-tint p-4 text-ink">
          <p className="font-serif text-lg">{t.newTitle}</p>
          <p className="mt-1 text-sm leading-relaxed">{t.newHint}</p>
          <OrderLinkCopy token={token} variant="banner" />
        </section>
      )}

      {!isNew && <OrderLinkCopy token={token} variant="secondary" />}

      {showCancel && (
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
      )}

      <footer className="pt-4 text-center text-xs text-muted">{copy.shopName}</footer>
    </div>
  );
}
