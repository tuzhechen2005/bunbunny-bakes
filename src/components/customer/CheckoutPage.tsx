"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import { formatCents } from "@/domain/pricing";
import {
  fetchAvailability,
  submitOrder,
  uuidV4,
  type Availability,
  type DateOption,
  type Fulfillment,
  type MenuProduct,
} from "@/lib/api";
import { cart, useCart, useHydrated } from "@/lib/cart";
import { breakdownText, fill, formatDollars } from "./format";
import { ProductPhoto } from "./ProductCard";
import { QtyStepper } from "./QtyStepper";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";

const t = copy.customer.checkout;
const WECHAT_MAX = 40;
const NOTE_MAX = 300;

type AvailState =
  | { status: "idle" | "loading" | "error"; data: Availability | null }
  | { status: "ready"; data: Availability };

interface SubmitError {
  message: string;
  /** FULL: the suggested date (YYYY-MM-DD). */
  suggestion?: string;
}

const sectionClass = "rounded-2xl border border-line bg-card p-4";
const sectionTitle = "mb-3 text-base font-semibold";

function safeDayLabel(date: string): string {
  try {
    return dayLabel(date);
  } catch {
    return date;
  }
}

function DateCard({
  option,
  selected,
  onSelect,
}: {
  option: DateOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const available = option.state === "AVAILABLE";
  const stateText =
    option.state === "AVAILABLE"
      ? (option.cutoffLabel ?? "")
      : option.state === "CUTOFF"
        ? t.stateCutoff
        : option.state === "FULL"
          ? t.stateFull
          : t.stateDeliveryFull;
  const tone = available
    ? selected
      ? "border-accent bg-soft ring-2 ring-accent"
      : "border-line bg-card"
    : option.state === "DELIVERY_FULL"
      ? "border-line bg-card opacity-70"
      : "border-line bg-soft text-disabled-ink opacity-70";
  return (
    <button
      type="button"
      className={`flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left ${tone}`}
      disabled={!available}
      aria-pressed={selected}
      onClick={onSelect}
      data-testid="date-card"
      data-date={option.date}
      data-state={option.state}
    >
      <span className="text-base font-semibold">{safeDayLabel(option.date)}</span>
      <span className={`text-xs ${available ? "text-muted" : ""}`}>{stateText}</span>
    </button>
  );
}

export function CheckoutPage() {
  const router = useRouter();
  const { status: menuStatus, menu, reload: reloadMenu } = useMenu();
  const items = useCart();
  const hydrated = useHydrated();

  const [fulfillment, setFulfillment] = useState<Fulfillment>("PICKUP");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [avail, setAvail] = useState<AvailState>({ status: "idle", data: null });
  const [availTick, setAvailTick] = useState(0);
  const [wechatId, setWechatId] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submittingRef = useRef(false);
  const keyRef = useRef<string>("");
  const availSeq = useRef(0);

  const cartKey = JSON.stringify(items);
  const menuReady = menuStatus === "ready";

  // One idempotency key per submission: new on mount and whenever cart, date or fulfillment change.
  useEffect(() => {
    keyRef.current = uuidV4();
  }, [cartKey, selectedDate, fulfillment]);

  // Re-query availability whenever the cart or fulfillment changes (DELIVERY_FULL depends on it).
  useEffect(() => {
    if (!menuReady || items.length === 0) return;
    const seq = ++availSeq.current;
    const timer = setTimeout(() => {
      setAvail((prev) => ({ status: "loading", data: prev.data }) as AvailState);
      fetchAvailability(items, fulfillment).then((result) => {
        if (seq !== availSeq.current) return; // a newer query is in flight
        if (!result.ok || !Array.isArray(result.data.dates)) {
          setAvail((prev) => ({ status: "error", data: prev.data }) as AvailState);
          return;
        }
        const data = result.data;
        setAvail({ status: "ready", data });
        setSelectedDate((current) =>
          current && data.dates.some((d) => d.date === current && d.state === "AVAILABLE") ? current : null,
        );
      });
    }, 150);
    return () => clearTimeout(timer);
    // `items` is captured through cartKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, fulfillment, menuReady, availTick]);

  const requery = () => setAvailTick((n) => n + 1);

  if (submitted) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-muted">
        <p role="status">{t.submitting}</p>
      </main>
    );
  }

  if (!hydrated || menuStatus === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-muted">
        <p>{copy.customer.home.loading}</p>
      </main>
    );
  }

  if (menuStatus === "error" || !menu) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p role="alert" className="text-danger">
          {copy.customer.home.loadFailed}
        </p>
        <button
          type="button"
          className="min-h-11 rounded-full border border-accent px-5 text-accent"
          onClick={reloadMenu}
        >
          {copy.customer.home.retry}
        </button>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" data-testid="empty-cart">
        <p className="text-lg">{t.emptyCart}</p>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-full bg-accent px-6 font-semibold text-accent-ink"
        >
          {t.emptyCartLink}
        </Link>
      </main>
    );
  }

  const byId = new Map<string, MenuProduct>(menu.products.map((p) => [p.id, p]));
  const lines = items.flatMap((i) => {
    const product = byId.get(i.productId);
    return product ? [{ ...i, product }] : [];
  });
  const data = avail.data;
  const problems = new Map<string, string>();
  for (const p of data?.cartProblems ?? []) if (!problems.has(p.productId)) problems.set(p.productId, p.error);
  const needsLeadHint = lines.some((l) => l.product.leadDays >= 2);
  const orderingEnabled = menu.orderingEnabled && (data ? data.orderingEnabled : true);
  const gap = data?.pricing.freeDeliveryGapCents ?? 0;
  // CAPACITY_RULES §7 rules 3–4: a cart with a paused/unavailable product or a qty over the
  // per-item max cannot check out. The offending lines explain why.
  const hasCartProblem = lines.some(
    (l) => l.product.status === "PAUSED" || problems.has(l.productId) || l.qty > menu.maxQtyPerItem,
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    setSubmitError(null);
    setWechatError(null);
    const trimmed = wechatId.trim();
    let invalid = false;
    if (!trimmed) {
      setWechatError(t.wechatRequired);
      invalid = true;
    }
    if (!selectedDate) {
      setSubmitError({ message: t.pickDate });
      invalid = true;
    }
    if (invalid || !selectedDate) return;

    submittingRef.current = true;
    setSubmitting(true);
    const result = await submitOrder({
      items: items.map(({ productId, qty }) => ({ productId, qty })),
      pickupDate: selectedDate,
      fulfillment,
      wechatId: trimmed.slice(0, WECHAT_MAX),
      note: note.slice(0, NOTE_MAX),
      idempotencyKey: keyRef.current,
      website,
    });

    if (result.ok) {
      setSubmitted(true);
      keyRef.current = uuidV4();
      cart.clear();
      router.replace(`/o/${encodeURIComponent(result.data.viewToken)}?new=1`);
      return; // stay locked while navigating
    }

    submittingRef.current = false;
    setSubmitting(false);
    const err = result.error;
    if (err.error === "NETWORK") {
      // No response: the order may exist; retry with the same key.
      setSubmitError({ message: copy.errors.fallback });
      return;
    }
    requery();
    switch (err.error) {
      case "FULL":
        setSubmitError(
          typeof err.suggestion === "string" && err.suggestion
            ? { message: copy.errors.FULL, suggestion: err.suggestion }
            : { message: copy.errors.FULL_NO_SUGGESTION },
        );
        break;
      case "DELIVERY_FULL":
      case "CUTOFF_PASSED":
      case "ORDERING_DISABLED":
      case "RATE_LIMITED":
      case "PRODUCT_UNAVAILABLE":
      case "QTY_LIMIT":
      case "DATE_CLOSED":
        setSubmitError({ message: copy.errors[err.error] });
        break;
      case "VALIDATION":
        // The server rejects a reused key with different contents: always start a new one.
        keyRef.current = uuidV4();
        if (err.fields?.wechatId) setWechatError(err.fields.wechatId);
        else setSubmitError({ message: copy.errors.fallback });
        break;
      default:
        setSubmitError({ message: copy.errors.fallback });
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 pt-4 pb-2">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-muted">
          {t.backToMenu}
        </Link>
        <h1 className="text-2xl font-bold">{t.pageTitle}</h1>
        {!orderingEnabled ? (
          <p className="mt-1 text-sm font-medium" data-testid="ordering-closed">
            {copy.home.orderingClosed}
          </p>
        ) : null}
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 px-4 pb-8" noValidate>
        {/* 1. Cart lines */}
        <section className={sectionClass}>
          <h2 className={sectionTitle}>{t.cartTitle}</h2>
          <ul className="flex flex-col divide-y divide-line">
            {lines.map(({ productId, qty, product }) => {
              const problem = problems.get(productId);
              const unavailable = product.status === "PAUSED" || problem === "PRODUCT_UNAVAILABLE";
              const overLimit = problem === "QTY_LIMIT" || qty > menu.maxQtyPerItem;
              const atMax = qty >= menu.maxQtyPerItem;
              return (
                <li key={productId} className="flex gap-3 py-3" data-testid="cart-line" data-product-id={productId}>
                  <ProductPhoto product={product} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{fill(t.lineName, { name: product.name, qty })}</p>
                    <p className="text-sm text-muted tabular-nums" data-testid="line-breakdown">
                      {breakdownText(qty, product)}
                    </p>
                    {unavailable ? (
                      <div className="mt-1 flex items-center gap-3">
                        <span className="text-sm text-danger">{copy.customer.home.paused}</span>
                        <button
                          type="button"
                          className="min-h-11 px-2 text-sm text-accent underline"
                          onClick={() => cart.remove(productId)}
                        >
                          {t.remove}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="mt-1 flex justify-end">
                          <QtyStepper
                            qty={qty}
                            canIncrease={!atMax}
                            onDecrease={() => cart.decrement(productId)}
                            onIncrease={() => cart.increment(productId, menu.maxQtyPerItem)}
                          />
                        </div>
                        {overLimit || atMax ? (
                          <p className="text-right text-xs text-danger">{copy.customer.home.maxReached}</p>
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 2. Dates */}
        <section className={sectionClass} data-testid="dates">
          <h2 className={sectionTitle}>{t.datesTitle}</h2>
          {needsLeadHint ? (
            <p className="mb-3 rounded-lg bg-soft px-3 py-2 text-sm" data-testid="lead-hint">
              {t.leadDaysHint}
            </p>
          ) : null}
          {data ? (
            data.dates.length === 0 ? (
              <p className="text-sm text-muted" data-testid="no-dates">
                {t.noDates}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {data.dates.map((d) => (
                  <DateCard
                    key={d.date}
                    option={d}
                    selected={selectedDate === d.date}
                    onSelect={() => {
                      setSelectedDate(d.date);
                      setSubmitError(null);
                    }}
                  />
                ))}
              </div>
            )
          ) : avail.status === "error" ? null : (
            <p className="text-sm text-muted">{t.datesLoading}</p>
          )}
          {avail.status === "error" ? (
            <div className="mt-2 flex items-center gap-3">
              <p role="alert" className="text-sm text-danger">
                {t.datesFailed}
              </p>
              <button type="button" className="min-h-11 px-2 text-sm text-accent underline" onClick={requery}>
                {t.retry}
              </button>
            </div>
          ) : null}
        </section>

        {/* 3. Pickup or delivery */}
        <section className={sectionClass}>
          <h2 className={sectionTitle}>{t.fulfillmentTitle}</h2>
          <div className="flex flex-col gap-2" role="radiogroup">
            {(["PICKUP", "DELIVERY"] as const).map((f) => {
              const checked = fulfillment === f;
              return (
                <label
                  key={f}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${checked ? "border-accent bg-soft" : "border-line"}`}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    value={f}
                    checked={checked}
                    onChange={() => setFulfillment(f)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{f === "PICKUP" ? t.pickup : t.delivery}</span>
                    {f === "PICKUP" ? (
                      <span className="text-sm break-words text-muted" data-testid="pickup-note">
                        {menu.pickupNote}
                      </span>
                    ) : (
                      <>
                        <span className="text-sm text-muted" data-testid="delivery-fee">
                          {fill(t.deliveryFee, {
                            fee: formatDollars(menu.deliveryFeeCents),
                            min: formatDollars(menu.freeDeliveryMinCents),
                          })}
                        </span>
                        {gap > 0 ? (
                          <span className="text-sm text-accent-strong" data-testid="delivery-gap">
                            {fill(t.freeDeliveryGap, { gap: formatCents(gap) })}
                          </span>
                        ) : null}
                        <span className="text-sm text-muted">{t.deliveryArrange}</span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* 4. WeChat ID */}
        <section className={sectionClass}>
          <label className="flex flex-col gap-1">
            <span className="text-base font-semibold">{t.wechatLabel}</span>
            <span className="text-sm text-muted">{t.wechatHint}</span>
            <input
              name="wechatId"
              className="mt-1 min-h-12 w-full rounded-lg border border-line bg-background px-3 text-base focus:border-accent focus:outline-none"
              value={wechatId}
              maxLength={WECHAT_MAX}
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={wechatError ? true : undefined}
              aria-describedby={wechatError ? "wechat-error" : undefined}
              onChange={(e) => {
                setWechatId(e.target.value);
                setWechatError(null);
              }}
            />
          </label>
          {wechatError ? (
            <p id="wechat-error" role="alert" className="mt-1 text-sm text-danger" data-testid="wechat-error">
              {wechatError}
            </p>
          ) : null}
        </section>

        {/* 5. Note */}
        <section className={sectionClass}>
          <label className="flex flex-col gap-1">
            <span className="text-base font-semibold">{t.noteLabel}</span>
            <textarea
              name="note"
              rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base focus:border-accent focus:outline-none"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            />
          </label>
          <p className="mt-1 text-right text-xs text-muted tabular-nums" data-testid="note-counter">
            {fill(t.noteCounter, { count: note.length, max: NOTE_MAX })}
          </p>
        </section>

        {/* Honeypot for bots: hidden from people and assistive tech. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {/* 6. Totals (server-computed, display only) */}
        <section className={sectionClass} data-testid="totals">
          <h2 className={sectionTitle}>{t.totalsTitle}</h2>
          {data ? (
            <dl className="flex flex-col gap-1 text-sm tabular-nums">
              <div className="flex justify-between">
                <dt>{t.subtotal}</dt>
                <dd data-testid="total-subtotal">{formatCents(data.pricing.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t.deliveryFeeLabel}</dt>
                <dd data-testid="total-fee">{formatCents(data.pricing.deliveryFeeCents)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>{t.total}</dt>
                <dd data-testid="total-total">{formatCents(data.pricing.totalCents)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t.datesLoading}</p>
          )}
        </section>

        <p className="text-center text-sm">{t.payLater}</p>

        {submitError ? (
          <div role="alert" className="rounded-xl bg-soft p-3 text-sm text-danger" data-testid="submit-error">
            <p>{submitError.message}</p>
            {submitError.suggestion ? (
              <button
                type="button"
                className="mt-2 min-h-11 rounded-full border border-accent px-4 font-medium text-accent"
                data-testid="suggestion"
                onClick={() => {
                  setSelectedDate(submitError.suggestion!);
                  setSubmitError(null);
                }}
              >
                {fill(t.switchDate, { day: safeDayLabel(submitError.suggestion) })}
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          className="min-h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-ink active:bg-accent-strong disabled:bg-disabled disabled:text-disabled-ink"
          disabled={submitting || !orderingEnabled || hasCartProblem}
          data-testid="submit"
        >
          {submitting ? t.submitting : t.submit}
        </button>
      </form>
      <SiteFooter ownerWechatId={menu.ownerWechatId} />
    </div>
  );
}
