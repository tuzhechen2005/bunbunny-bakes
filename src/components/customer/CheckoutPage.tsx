"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { useMotionPrefs } from "@/lib/motion/react";
import { FieldError } from "./checkout/FieldError";
import { RollNumber } from "./checkout/RollNumber";
import { breakdownText, fill, formatDollars } from "./format";
import { ProductPhoto } from "./ProductCard";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";

const t = copy.customer.checkout;
const home = copy.customer.home;
const WECHAT_MAX = 40;
const NOTE_MAX = 300;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** sessionStorage key the order page reads to draw the bag (G4). */
const LAST_BAG_KEY = "bunbunny:lastBag";

type AvailState =
  | { status: "idle" | "loading" | "error"; data: Availability | null }
  | { status: "ready"; data: Availability };

interface SubmitError {
  message: string;
  /** FULL: the suggested date (YYYY-MM-DD). */
  suggestion?: string;
  /** Which block shows it: the date block, or just above the submit button. */
  where: "date" | "submit";
}

const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";

function safeDayLabel(date: string): string {
  try {
    return dayLabel(date);
  } catch {
    return date;
  }
}

/** "10/30 周五" -> ["10/30", "周五"] (display only). */
function splitDayLabel(date: string): [string, string] {
  const label = safeDayLabel(date);
  const i = label.indexOf(" ");
  return i < 0 ? [label, ""] : [label.slice(0, i), label.slice(i + 1)];
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Numbered block (prototype `.blk`): number, title, optional note on the right. */
function Block({
  n,
  title,
  note,
  noteTestId,
  testId,
  children,
}: {
  n: number;
  title: string;
  note?: string;
  noteTestId?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-[34px]" data-rise="" data-testid={testId}>
      <h2 className="mb-3.5 flex items-baseline gap-2.5 font-display text-[19px] leading-[1.2] tracking-[-0.02em]">
        <span className="w-3.5 font-num text-[15px] font-semibold text-c-grey" aria-hidden="true">
          {n}
        </span>
        {title}
        {note ? (
          <small className="ml-auto font-sans text-[12.5px] leading-none font-medium tracking-normal text-c-grey" data-testid={noteTestId}>
            {note}
          </small>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

function DateCard({
  option,
  selected,
  reduced,
  onSelect,
}: {
  option: DateOption;
  selected: boolean;
  reduced: boolean;
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
  const [md, weekday] = splitDayLabel(option.date);
  // Closed days (cutoff, full) strike the date through; delivery-only-full stays readable.
  const struck = option.state === "CUTOFF" || option.state === "FULL";
  const tone = available
    ? selected
      ? "border-c-ink bg-c-ink text-c-paper"
      : "border-c-line bg-c-paper text-c-ink"
    : "cursor-not-allowed border-c-wash bg-c-wash text-c-grey/70";
  return (
    <button
      type="button"
      className={`flex min-h-[112px] w-[100px] flex-none flex-col items-start justify-between rounded-[20px] border-[1.5px] px-3.5 pt-3.5 pb-[13px] text-left transition-[background-color,border-color,color,transform] duration-[250ms] ${tone} ${available ? "active:scale-[0.96] motion-reduce:active:scale-100" : ""} ${focusRing}`}
      disabled={!available}
      aria-pressed={selected}
      onClick={(e) => {
        const el = e.currentTarget;
        if (!reduced && typeof el.animate === "function") {
          el.animate([{ transform: "scale(.94)" }, { transform: "scale(1.03)", offset: 0.5 }, { transform: "none" }], {
            duration: 360,
            easing: EASE,
          });
        }
        onSelect();
      }}
      data-testid="date-card"
      data-date={option.date}
      data-state={option.state}
    >
      <span className={`font-num text-[27px] leading-none font-bold ${struck ? "line-through decoration-2" : ""}`}>{md}</span>
      {" "}
      <span className="text-sm leading-none font-bold">{weekday}</span>
      <small className={`text-[11.5px] leading-tight font-medium ${available ? (selected ? "text-c-paper/65" : "text-c-grey") : ""}`}>
        {stateText}
      </small>
    </button>
  );
}

function RoundButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`grid h-11 w-11 place-items-center rounded-full text-c-ink transition-transform duration-[180ms] active:scale-95 disabled:opacity-35 motion-reduce:active:scale-100 ${focusRing}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full border-[1.5px] border-c-line">{children}</span>
    </button>
  );
}

/** − qty + for a cart line, 44px touch targets. */
function LineStepper({
  qty,
  canIncrease,
  onDecrease,
  onIncrease,
}: {
  qty: number;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <RoundButton label={home.decrease} disabled={qty <= 0} onClick={onDecrease}>
        <Icon>
          <path d="M5 12h14" />
        </Icon>
      </RoundButton>
      <span className="min-w-5 text-center font-num text-base font-bold" aria-label={fill(home.qtyLabel, { qty })} data-testid="qty">
        {qty}
      </span>
      <RoundButton label={home.increase} disabled={!canIncrease} onClick={onIncrease}>
        <Icon>
          <path d="M12 5v14M5 12h14" />
        </Icon>
      </RoundButton>
    </div>
  );
}

/** White page in the centred 430px column (the desktop shows the same column). */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-c-wash text-c-ink">
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col overflow-x-clip bg-c-paper">{children}</div>
    </div>
  );
}

export function CheckoutPage() {
  const router = useRouter();
  const { status: menuStatus, menu, reload: reloadMenu } = useMenu();
  const items = useCart();
  const hydrated = useHydrated();
  const { reduced } = useMotionPrefs();

  const [fulfillment, setFulfillment] = useState<Fulfillment>("PICKUP");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [avail, setAvail] = useState<AvailState>({ status: "idle", data: null });
  const [availTick, setAvailTick] = useState(0);
  const [wechatId, setWechatId] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  // Bumped whenever an error is raised, so the error line shakes again even with the same text.
  const [errorSeq, setErrorSeq] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submittingRef = useRef(false);
  const keyRef = useRef<string>("");
  const availSeq = useRef(0);
  const pageRef = useRef<HTMLDivElement>(null);

  const cartKey = JSON.stringify(items);
  const menuReady = menuStatus === "ready";
  const showForm = hydrated && menuReady && !!menu && items.length > 0 && !submitted;

  const raiseSubmitError = (error: SubmitError) => {
    setSubmitError(error);
    setErrorSeq((n) => n + 1);
  };
  const raiseWechatError = (message: string) => {
    setWechatError(message);
    setErrorSeq((n) => n + 1);
  };

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

  // Blocks rise in one after another when the form first shows (reduced motion: fade only).
  useEffect(() => {
    if (!showForm) return;
    const nodes = pageRef.current?.querySelectorAll<HTMLElement>("[data-rise]");
    nodes?.forEach((node, k) => {
      if (typeof node.animate !== "function") return;
      node.animate(
        [
          { opacity: 0, transform: reduced ? "none" : "translateY(16px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 480, delay: 80 + k * 60, easing: EASE, fill: "backwards" },
      );
    });
    // Once per appearance of the form, not on every motion-pref change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  // Keep the chosen date card in view in the horizontal list (e.g. after "switch to this date").
  useEffect(() => {
    if (!selectedDate) return;
    const card = pageRef.current?.querySelector<HTMLElement>(`[data-testid="date-card"][data-date="${selectedDate}"]`);
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const requery = () => setAvailTick((n) => n + 1);

  if (submitted) {
    return (
      <Shell>
        <main className="flex flex-1 items-center justify-center p-8 text-c-grey">
          <p role="status">{t.submitting}</p>
        </main>
      </Shell>
    );
  }

  if (!hydrated || menuStatus === "loading") {
    return (
      <Shell>
        <main className="flex flex-1 items-center justify-center p-8 text-c-grey">
          <p>{copy.customer.home.loading}</p>
        </main>
      </Shell>
    );
  }

  if (menuStatus === "error" || !menu) {
    return (
      <Shell>
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p role="alert" className="font-semibold text-c-red">
            {copy.customer.home.loadFailed}
          </p>
          <button
            type="button"
            className={`min-h-11 rounded-full border-[1.5px] border-c-ink px-5 font-bold ${focusRing}`}
            onClick={reloadMenu}
          >
            {copy.customer.home.retry}
          </button>
        </main>
      </Shell>
    );
  }

  if (items.length === 0) {
    return (
      <Shell>
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" data-testid="empty-cart">
          <p className="font-display text-xl">{t.emptyCart}</p>
          <Link
            href="/"
            className={`flex min-h-11 items-center rounded-full bg-c-ink px-6 font-bold text-c-paper ${focusRing}`}
          >
            {t.emptyCartLink}
          </Link>
        </main>
      </Shell>
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
      raiseWechatError(t.wechatRequired);
      invalid = true;
    }
    if (!selectedDate) {
      raiseSubmitError({ message: t.pickDate, where: "date" });
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
      // Best effort: the order page draws the ordered bread in the bag (G4). Never blocks the redirect.
      try {
        sessionStorage.setItem(
          LAST_BAG_KEY,
          JSON.stringify({
            orderNo: result.data.orderNo,
            items: lines.map((l) => ({ name: l.product.name, imageUrl: l.product.imageUrl, qty: l.qty })),
          }),
        );
      } catch {
        /* storage unavailable (private mode, quota): the order page falls back */
      }
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
      raiseSubmitError({ message: copy.errors.fallback, where: "submit" });
      return;
    }
    requery();
    switch (err.error) {
      case "FULL":
        raiseSubmitError(
          typeof err.suggestion === "string" && err.suggestion
            ? { message: copy.errors.FULL, suggestion: err.suggestion, where: "date" }
            : { message: copy.errors.FULL_NO_SUGGESTION, where: "date" },
        );
        break;
      case "DELIVERY_FULL":
      case "CUTOFF_PASSED":
      case "DATE_CLOSED":
        raiseSubmitError({ message: copy.errors[err.error], where: "date" });
        break;
      case "ORDERING_DISABLED":
      case "RATE_LIMITED":
      case "PRODUCT_UNAVAILABLE":
      case "QTY_LIMIT":
        raiseSubmitError({ message: copy.errors[err.error], where: "submit" });
        break;
      case "VALIDATION":
        // The server rejects a reused key with different contents: always start a new one.
        keyRef.current = uuidV4();
        if (err.fields?.wechatId) raiseWechatError(err.fields.wechatId);
        else raiseSubmitError({ message: copy.errors.fallback, where: "submit" });
        break;
      default:
        raiseSubmitError({ message: copy.errors.fallback, where: "submit" });
    }
  }

  const delivery = fulfillment === "DELIVERY";
  const dateError = submitError?.where === "date" ? submitError : null;
  const bottomError = submitError?.where === "submit" ? submitError : null;

  return (
    <Shell>
      <main ref={pageRef} className="flex flex-1 flex-col px-5 pb-[calc(30px+env(safe-area-inset-bottom))]">
        <div className="-mx-2.5 flex h-[62px] items-center">
          <Link
            href="/"
            className={`grid h-11 w-11 place-items-center rounded-full text-c-ink ${focusRing}`}
            aria-label={t.backToMenu}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
        </div>
        <h1 className="mt-1.5 font-display text-[38px] leading-[1.1] tracking-[-0.05em]">{t.pageTitle}</h1>
        {!orderingEnabled ? (
          <p className="mt-2.5 text-sm font-semibold text-c-red" data-testid="ordering-closed">
            {copy.home.orderingClosed}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="flex flex-col" noValidate>
          {/* Cart lines */}
          <ul className="mt-6 flex flex-col divide-y divide-c-line" aria-label={t.cartTitle} data-rise="">
            {lines.map(({ productId, qty, product }) => {
              const problem = problems.get(productId);
              const unavailable = product.status === "PAUSED" || problem === "PRODUCT_UNAVAILABLE";
              const overLimit = problem === "QTY_LIMIT" || qty > menu.maxQtyPerItem;
              const atMax = qty >= menu.maxQtyPerItem;
              return (
                <li key={productId} className="flex items-center gap-3 py-3" data-testid="cart-line" data-product-id={productId}>
                  <ProductPhoto
                    product={product}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-[14px] ${unavailable ? "opacity-50 grayscale" : ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug font-bold break-words">{fill(t.lineName, { name: product.name, qty })}</p>
                    <p className="font-num text-[13px] leading-snug font-semibold text-c-grey" data-testid="line-breakdown">
                      {breakdownText(qty, product)}
                    </p>
                    {unavailable ? (
                      <p className="text-xs font-semibold text-c-red">{home.paused}</p>
                    ) : overLimit || atMax ? (
                      <p className="text-xs font-semibold text-c-red">{home.maxReached}</p>
                    ) : null}
                  </div>
                  {unavailable ? (
                    <button
                      type="button"
                      className={`min-h-11 shrink-0 px-2 text-sm font-bold underline ${focusRing}`}
                      onClick={() => cart.remove(productId)}
                    >
                      {t.remove}
                    </button>
                  ) : (
                    <LineStepper
                      qty={qty}
                      canIncrease={!atMax}
                      onDecrease={() => cart.decrement(productId)}
                      onIncrease={() => cart.increment(productId, menu.maxQtyPerItem)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {/* 1. Dates */}
          <Block
            n={1}
            title={t.datesTitle}
            note={needsLeadHint ? t.leadDaysHint : undefined}
            noteTestId="lead-hint"
            testId="dates"
          >
            {data ? (
              data.dates.length === 0 ? (
                <p className="text-sm text-c-grey" data-testid="no-dates">
                  {t.noDates}
                </p>
              ) : (
                <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {data.dates.map((d) => (
                    <DateCard
                      key={d.date}
                      option={d}
                      selected={selectedDate === d.date}
                      reduced={reduced}
                      onSelect={() => {
                        setSelectedDate(d.date);
                        setSubmitError(null);
                      }}
                    />
                  ))}
                </div>
              )
            ) : avail.status === "error" ? null : (
              <p className="text-sm text-c-grey">{t.datesLoading}</p>
            )}
            {avail.status === "error" ? (
              <div className="mt-2 flex items-center gap-3">
                <p role="alert" className="text-sm font-semibold text-c-red">
                  {t.datesFailed}
                </p>
                <button type="button" className={`min-h-11 px-2 text-sm font-bold underline ${focusRing}`} onClick={requery}>
                  {t.retry}
                </button>
              </div>
            ) : null}
            {dateError ? (
              <FieldError message={dateError.message} seq={errorSeq} testId="submit-error">
                {dateError.suggestion ? (
                  <button
                    type="button"
                    className={`mt-2 min-h-11 rounded-full border-[1.5px] border-c-red px-4 text-sm font-bold text-c-red ${focusRing}`}
                    data-testid="suggestion"
                    onClick={() => {
                      setSelectedDate(dateError.suggestion!);
                      setSubmitError(null);
                    }}
                  >
                    {fill(t.switchDate, { day: safeDayLabel(dateError.suggestion) })}
                  </button>
                ) : null}
              </FieldError>
            ) : null}
          </Block>

          {/* 2. Pickup or delivery */}
          <Block n={2} title={t.fulfillmentTitle}>
            <div
              role="radiogroup"
              className="relative grid h-[58px] grid-cols-2 rounded-[18px] bg-c-wash p-1"
            >
              <i
                aria-hidden="true"
                className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-[14px] bg-c-paper shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-transform duration-[450ms] ease-[var(--ease)] motion-reduce:transition-none"
                style={{ transform: delivery ? "translateX(100%)" : "none" }}
              />
              {(["PICKUP", "DELIVERY"] as const).map((f) => {
                const checked = fulfillment === f;
                return (
                  <label
                    key={f}
                    className={`relative flex cursor-pointer items-center justify-center rounded-[14px] text-base font-bold transition-colors duration-300 has-[:focus-visible]:outline-[2.5px] has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-c-red ${checked ? "text-c-ink" : "text-c-grey"}`}
                  >
                    <input
                      type="radio"
                      name="fulfillment"
                      value={f}
                      checked={checked}
                      onChange={() => setFulfillment(f)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    {f === "PICKUP" ? t.pickup : t.delivery}
                  </label>
                );
              })}
            </div>
            <div className="mt-2.5 text-[13px] leading-[1.55] text-c-grey">
              {delivery ? (
                <>
                  <p>
                    <span data-testid="delivery-fee">
                      {fill(t.deliveryFee, {
                        fee: formatDollars(menu.deliveryFeeCents),
                        min: formatDollars(menu.freeDeliveryMinCents),
                      })}
                    </span>
                    {gap > 0 ? (
                      <>
                        {t.deliveryGapJoin}
                        <b className="font-bold text-c-red" data-testid="delivery-gap">
                          {fill(t.freeDeliveryGap, { gap: formatCents(gap) })}
                        </b>
                      </>
                    ) : null}
                  </p>
                  <p>{t.deliveryArrange}</p>
                </>
              ) : (
                <p className="break-words" data-testid="pickup-note">
                  {menu.pickupNote}
                </p>
              )}
            </div>
          </Block>

          {/* 3. WeChat ID */}
          <Block n={3} title={t.wechatLabel}>
            <input
              name="wechatId"
              aria-label={t.wechatLabel}
              placeholder={t.wechatHint}
              className="w-full rounded-none border-0 border-b-2 border-c-ink bg-transparent pt-2 pb-2.5 text-[21px] leading-[1.3] font-semibold text-c-ink outline-none transition-colors placeholder:font-medium placeholder:text-c-grey/50 focus:border-c-red"
              value={wechatId}
              maxLength={WECHAT_MAX}
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={wechatError ? true : undefined}
              aria-describedby={wechatError ? "wechat-error" : undefined}
              onChange={(e) => {
                setWechatId(e.target.value);
                setWechatError(null);
              }}
            />
            {wechatError ? (
              <FieldError
                id="wechat-error"
                message={wechatError}
                seq={errorSeq}
                scroll={!dateError}
                testId="wechat-error"
              />
            ) : null}
          </Block>

          {/* 4. Note */}
          <Block n={4} title={t.noteLabel} note={t.noteOptional}>
            <textarea
              name="note"
              aria-label={t.noteLabel}
              rows={3}
              className="min-h-[92px] w-full resize-none rounded-2xl border-[1.5px] border-c-line px-3.5 py-3 text-base leading-normal text-c-ink outline-none transition-colors focus:border-c-ink"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            />
            <p className="mt-1.5 text-right text-xs text-c-grey tabular-nums" data-testid="note-counter">
              {fill(t.noteCounter, { count: note.length, max: NOTE_MAX })}
            </p>
          </Block>

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

          {/* Totals (server-computed, display only) */}
          <section className="mt-[34px] border-t-[1.5px] border-c-ink pt-[18px]" data-rise="" data-testid="totals">
            {data ? (
              <>
                {delivery ? (
                  <div className="flex items-baseline justify-between text-[15px] leading-8">
                    <span>{t.deliveryFeeLabel}</span>
                    <RollNumber value={formatCents(data.pricing.deliveryFeeCents)} className="font-num font-semibold" testId="total-fee" />
                  </div>
                ) : null}
                <div className="mt-1.5 flex items-baseline justify-between font-display text-lg leading-none">
                  <span>{t.total}</span>
                  <RollNumber value={formatCents(data.pricing.totalCents)} className="font-num text-[40px] leading-[1.15] font-bold" testId="total-total" />
                </div>
              </>
            ) : (
              <p className="text-sm text-c-grey">{t.datesLoading}</p>
            )}
          </section>

          <p className="mt-3.5 mb-[18px] text-[13px] leading-normal text-c-grey">{t.payLater}</p>

          {bottomError ? <FieldError message={bottomError.message} seq={errorSeq} testId="submit-error" /> : null}

          <button
            type="submit"
            className={`mt-3 flex h-[58px] w-full items-center justify-center rounded-[29px] bg-c-ink text-base leading-none font-bold text-c-paper transition-transform duration-[180ms] active:scale-95 disabled:opacity-35 motion-reduce:active:scale-100 ${focusRing}`}
            disabled={submitting || !orderingEnabled || hasCartProblem}
            data-testid="submit"
          >
            {submitting ? t.submitting : t.submit}
          </button>
        </form>
        <SiteFooter ownerWechatId={menu.ownerWechatId} />
      </main>
    </Shell>
  );
}
