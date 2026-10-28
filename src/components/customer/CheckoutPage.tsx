"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Stepper } from "@/components/ui/Stepper";
import { AssistantEntry } from "./assistant/AssistantEntry";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import "@/components/ui/ui.css";
import { copy } from "@/copy";
import { dayLabel, weekdayOf } from "@/domain/dates";
import { formatCents } from "@/domain/pricing";
import {
  fetchAvailability,
  submitOrder,
  uuidV4,
  type Availability,
  type DateHint,
  type DateOption,
  type Fulfillment,
  type MenuProduct,
} from "@/lib/api";
import { cart, clearPreferredDate, getPreferredDate, setPreferredDate, useCart, useHydrated, type CartItem } from "@/lib/cart";
import { useMotionPrefs } from "@/lib/motion/react";
import { myOrders } from "@/lib/myOrders";
import { pendingSave } from "@/lib/pendingSave";
import { FieldError } from "./checkout/FieldError";
import { RollNumber } from "./checkout/RollNumber";
import { breakdownText, fill, formatDollars, weekdayList } from "./format";
import { ProductPhoto } from "./ProductCard";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";

const t = copy.customer.checkout;
const home = copy.customer.home;
const bagCopy = copy.customer.bag;
const WECHAT_MAX = 40;
const NOTE_MAX = 300;
/** The character counter of the note only shows when the limit is getting close. */
const NOTE_COUNTER_FROM = 240;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** sessionStorage key the order page reads to draw the bag (G4). */
const LAST_BAG_KEY = "bunbunny:lastBag";
/** sessionStorage key the order page reads for the "second order is waiting" line (C1 split). */
const SPLIT_REST_KEY = "bunbunny:splitRest";

/** A split order in progress: this order takes `here`; `rest` stays in the bag for the second one. */
interface SplitPlan {
  here: CartItem[];
  rest: CartItem[];
  restDate: string | null;
}

const pieceCount = (list: readonly CartItem[]) => list.reduce((n, i) => n + i.qty, 0);

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

/** The new order goes into 我的订单 and its save-link dialog becomes due (D84, D89). */
function rememberOrder(token: string, orderNo: string): void {
  myOrders.record(token, orderNo, Date.now());
  pendingSave.add(token);
}

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
  reason,
  onSelect,
}: {
  option: DateOption;
  selected: boolean;
  reduced: boolean;
  /** WEEKDAY dates: why, e.g. "泡芙仅周三". */
  reason?: string;
  onSelect: () => void;
}) {
  const available = option.state === "AVAILABLE";
  // A full / weekday date with hints can be tapped to show them; it still cannot be ordered as is.
  const tappable = available || (!!option.hints && option.hints.length > 0);
  const stateText =
    option.state === "AVAILABLE"
      ? (option.cutoffLabel ?? "")
      : option.state === "CUTOFF"
        ? t.stateCutoff
        : option.state === "WEEKDAY"
          ? (reason ?? t.stateFull)
          : option.state === "FULL"
            ? t.stateFull
            : t.stateDeliveryFull;
  const [md, weekday] = splitDayLabel(option.date);
  // Closed days (cutoff, full) strike the date through; delivery-only-full stays readable.
  const struck = option.state === "CUTOFF" || option.state === "FULL" || option.state === "WEEKDAY";
  const tone = available
    ? selected
      ? "border-c-ink bg-c-ink text-c-paper"
      : "border-c-line bg-c-paper text-c-ink"
    : selected
      ? "border-c-ink bg-c-wash text-c-grey"
      : `${tappable ? "" : "cursor-not-allowed "}border-c-wash bg-c-wash text-c-grey/70`;
  return (
    <button
      type="button"
      className={`flex min-h-[112px] w-[100px] flex-none snap-start flex-col items-start justify-between rounded-[20px] border-[1.5px] px-3.5 pt-3.5 pb-[13px] text-left transition-[background-color,border-color,color,transform] duration-[250ms] ${tone} ${available ? "active:scale-[0.96] motion-reduce:active:scale-100" : ""} ${focusRing}`}
      disabled={!tappable}
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
      data-hints={!available && tappable ? "true" : undefined}
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

function HintButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`min-h-11 shrink-0 rounded-full border-[1.5px] border-c-red px-4 text-sm font-bold text-c-red ${focusRing}`}
      data-testid="hint-apply"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** One-tap ways out of a full / weekday date (C1 hints). Quantities only. */
function HintRows({
  option,
  byId,
  onReduce,
  onSplit,
}: {
  option: DateOption;
  byId: Map<string, MenuProduct>;
  onReduce: (hint: Extract<DateHint, { kind: "REDUCE" }>) => void;
  onSplit: (hint: Extract<DateHint, { kind: "SPLIT" }>) => void;
}) {
  const day = safeDayLabel(option.date);
  const weekday = splitDayLabel(option.date)[1];
  const rows: ReactNode[] = [];
  (option.hints ?? []).forEach((hint, k) => {
    let text: string | null = null;
    let button: ReactNode = null;
    if (hint.kind === "REDUCE") {
      const parts = hint.remove.flatMap((r) => {
        const p = byId.get(r.productId);
        return p ? [fill(t.pieces, { n: r.qty, name: p.name })] : [];
      });
      if (parts.length === 0) return;
      text = fill(t.hintReduce, { remove: parts.join(t.pieceJoin), day });
      button = <HintButton label={t.hintReduceApply} onClick={() => onReduce(hint)} />;
    } else if (hint.kind === "SPLIT" && hint.reason === "CAPACITY") {
      if (!hint.restDate || hint.here.length === 0) return;
      text = fill(t.hintSplitCapacity, {
        day,
        here: pieceCount(hint.here),
        rest: pieceCount(hint.rest),
        restDay: safeDayLabel(hint.restDate),
      });
      button = <HintButton label={fill(t.hintSplitCapacityApply, { weekday })} onClick={() => onSplit(hint)} />;
    } else if (hint.kind === "SPLIT" && hint.reason === "WEEKDAY") {
      const restricted = byId.get(hint.rest[0]?.productId ?? "");
      if (!restricted || hint.here.length === 0) return;
      text = fill(t.hintSplitWeekday, { name: restricted.name, days: weekdayList(restricted.pickupWeekdays ?? []) });
      button = <HintButton label={fill(t.hintSplitWeekdayApply, { weekday })} onClick={() => onSplit(hint)} />;
    }
    if (!text) return;
    rows.push(
      <div key={k} className="mt-2 flex items-center gap-3" data-testid="hint-row" data-kind={hint.kind === "SPLIT" ? `SPLIT_${hint.reason}` : hint.kind}>
        <p className="min-w-0 flex-1">{text}</p>
        {button}
      </div>,
    );
  });
  return rows.length ? <>{rows}</> : null;
}

/** Four date cards while the dates load (same size as the real ones, so nothing jumps). */
function DatesSkeleton({ heading = false }: { heading?: boolean }) {
  return (
    <div className={heading ? "mt-[34px]" : undefined} aria-busy="true" data-testid="dates-skeleton">
      {heading ? <div className="ui-skel mb-3.5 h-6 w-28 rounded-full" aria-hidden="true" /> : null}
      <div className="-mx-5 flex gap-2.5 overflow-hidden px-5 pt-1 pb-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ui-skel h-[112px] w-[100px] flex-none rounded-[20px]" />
        ))}
      </div>
      <p role="status" className="sr-only">
        {t.datesLoading}
      </p>
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
  const liveItems = useCart();
  // Set when the order is created: the form stays on screen (button 提交中…) while the page navigates.
  const [frozen, setFrozen] = useState<readonly CartItem[] | null>(null);
  const cartItems = frozen ?? liveItems;
  // A split order: this order holds only `here`, the rest waits in the bag.
  // It belongs to the bag it was made from: when the bag changes the plan is void.
  const liveKey = JSON.stringify(liveItems);
  const [splitRaw, setSplitRaw] = useState<{ plan: SplitPlan; liveKey: string } | null>(null);
  const splitPlan = splitRaw && splitRaw.liveKey === liveKey ? splitRaw.plan : null;
  const setSplitPlan = (plan: SplitPlan | null) => setSplitRaw(plan ? { plan, liveKey } : null);
  // A full / weekday date the customer tapped to see its hints.
  const [hintDate, setHintDate] = useState<string | null>(null);
  const items = splitPlan ? splitPlan.here : cartItems;
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

  const submittingRef = useRef(false);
  const keyRef = useRef<string>("");
  const availSeq = useRef(0);
  const pageRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  // True once an order was created (here or after the customer had left) and nothing is in flight.
  const finished = useRef(false);
  /** The POST is on its way (the response has not arrived yet). */
  const inflight = useRef(false);
  // With cacheComponents this page stays mounted, hidden, after it navigates away, and the same
  // instance is shown again by the next visit. The effect re-runs on every show: after a finished
  // order the page starts over (new cart lines, enabled button, new key); a POST still in flight
  // keeps the lock.
  useEffect(() => {
    mounted.current = true;
    if (finished.current && !inflight.current) {
      finished.current = false;
      submittingRef.current = false;
      setFrozen(null);
      setSubmitting(false);
      setSubmitError(null);
      setWechatError(null);
      setSelectedDate(null);
      setSplitRaw(null);
      setHintDate(null);
      setAvailTick((n) => n + 1);
      keyRef.current = uuidV4();
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const cartKey = JSON.stringify(items);

  const menuReady = menuStatus === "ready";
  const showForm = hydrated && menuReady && !!menu && items.length > 0;

  const raiseSubmitError = (error: SubmitError) => {
    setSubmitError(error);
    setErrorSeq((n) => n + 1);
  };
  const raiseWechatError = (message: string) => {
    setWechatError(message);
    setErrorSeq((n) => n + 1);
  };

  // One idempotency key per submission: new on mount and whenever cart, date or fulfillment really
  // change. The effect also re-runs when this preserved page is shown again; then the signature is
  // the same and the key stays, so a retry after a NETWORK error is still the same order.
  const keyFor = useRef("");
  useEffect(() => {
    const sig = `${cartKey}|${selectedDate}|${fulfillment}`;
    if (keyFor.current === sig) return;
    keyFor.current = sig;
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
        // Hand-off from a split order / the assistant: preselect the preferred date once, if it is open.
        let preferred: string | null = null;
        if (!finished.current) {
          const pref = getPreferredDate();
          if (pref) {
            clearPreferredDate();
            if (data.dates.some((d) => d.date === pref && d.state === "AVAILABLE")) preferred = pref;
          }
        }
        setSelectedDate((current) =>
          current && data.dates.some((d) => d.date === current && d.state === "AVAILABLE") ? current : preferred,
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

  const top = <TopBar backHref="/" backLabel={t.backToMenu} title={t.pageTitle} titleAs="h1" />;

  if (!hydrated || menuStatus === "loading") {
    return (
      <Shell>
        {top}
        <main className="flex flex-1 flex-col px-5 pb-[calc(30px+env(safe-area-inset-bottom))]" aria-busy="true">
          <p role="status" className="sr-only">
            {home.loading}
          </p>
          <ul className="mt-4 flex list-none flex-col divide-y divide-c-line p-0" aria-hidden="true" data-testid="lines-skeleton">
            {Array.from({ length: Math.min(Math.max(items.length, 1), 3) }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <div className="ui-skel h-14 w-14 shrink-0 rounded-[14px]" />
                <div className="ui-skel h-5 w-32 rounded-full" />
              </li>
            ))}
          </ul>
          <DatesSkeleton heading />
        </main>
      </Shell>
    );
  }

  if (menuStatus === "error" || !menu) {
    return (
      <Shell>
        {top}
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
        {top}
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
  // D96: the product with the longest lead time (ties: the first in the bag) names the hint.
  const leadLine = lines.reduce<(typeof lines)[number] | null>(
    (best, l) => (l.product.leadDays > 1 && (!best || l.product.leadDays > best.product.leadDays) ? l : best),
    null,
  );
  const leadHint = leadLine ? fill(t.leadDaysHint, { name: leadLine.product.name, n: leadLine.product.leadDays }) : undefined;
  const orderingEnabled = menu.orderingEnabled && (data ? data.orderingEnabled : true);
  const gap = data?.pricing.freeDeliveryGapCents ?? 0;
  // CAPACITY_RULES §7 rules 3–4: a cart with a paused/unavailable product or a qty over the
  // per-item max cannot check out. The offending lines explain why.
  const hasUnavailable = lines.some((l) => l.product.status === "PAUSED" || problems.get(l.productId) === "PRODUCT_UNAVAILABLE");
  const hasCartProblem =
    hasUnavailable || lines.some((l) => problems.has(l.productId) || l.qty > menu.maxQtyPerItem);
  // Say why 确认提交预订 is disabled (the totals themselves always come from the server).
  const blockedReason = hasUnavailable ? t.blockedUnavailable : hasCartProblem ? copy.errors.QTY_LIMIT : null;

  /** After an order: empty the bag, or leave the rest of a split in it (with its preferred date). */
  function leaveRest(split: SplitPlan | null) {
    if (!split) {
      cart.clear();
      return;
    }
    cart.replace(split.rest);
    if (split.restDate) setPreferredDate(split.restDate);
  }

  const applyReduce = (hint: Extract<DateHint, { kind: "REDUCE" }>) => {
    for (const r of hint.remove) {
      const current = cart.getItems().find((i) => i.productId === r.productId)?.qty ?? 0;
      cart.setQty(r.productId, current - r.qty, current);
    }
    if (hintDate) setSelectedDate(hintDate);
    setHintDate(null);
    setSubmitError(null);
  };
  const applySplit = (hint: Extract<DateHint, { kind: "SPLIT" }>) => {
    setSplitPlan({ here: hint.here, rest: hint.rest, restDate: hint.restDate });
    if (hintDate) setSelectedDate(hintDate);
    setHintDate(null);
    setSubmitError(null);
  };

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
    inflight.current = true;
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

    inflight.current = false;
    const split = splitPlan;
    const liveAtSubmit = JSON.stringify(cartItems);
    if (result.ok) {
      // Everything below also runs when the customer has already left this page: the response is
      // still handled, so the order is in 我的订单 and its save-link modal is still due.
      const { orderNo, viewToken } = result.data;
      // Best effort: the order page draws the ordered bread in the bag (G4). Never blocks the redirect.
      try {
        sessionStorage.setItem(
          LAST_BAG_KEY,
          JSON.stringify({
            orderNo,
            token: viewToken,
            items: lines.map((l) => ({ name: l.product.name, imageUrl: l.product.imageUrl, qty: l.qty })),
          }),
        );
      } catch {
        /* storage unavailable (private mode, quota): the order page falls back */
      }
      rememberOrder(viewToken, orderNo);
      if (split) {
        // The second order is a normal order the customer places themselves (C1 split).
        try {
          sessionStorage.setItem(
            SPLIT_REST_KEY,
            JSON.stringify({
              token: viewToken,
              items: split.rest.flatMap((r) => {
                const p = byId.get(r.productId);
                return p ? [{ productId: r.productId, name: p.name, qty: r.qty }] : [];
              }),
            }),
          );
        } catch {
          /* optional */
        }
      }
      keyRef.current = uuidV4();
      finished.current = true;
      if (mounted.current) {
        setFrozen(items);
        leaveRest(split);
        router.replace(`/o/${encodeURIComponent(viewToken)}?new=1`);
        return; // stay locked while navigating; the next show of this page starts over
      }
      // Gone already: do not pull them to the order page; only empty the bag if it is still this
      // order, and unlock so a later visit to this (preserved) page is not stuck on 提交中…
      if (JSON.stringify(cart.getItems()) === liveAtSubmit) leaveRest(split);
      submittingRef.current = false;
      setSubmitting(false);
      return;
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
    if (err.error === "FULL" || err.error === "WEEKDAY_UNAVAILABLE") setHintDate(selectedDate);
    switch (err.error) {
      case "WEEKDAY_UNAVAILABLE":
        raiseSubmitError({ message: copy.errors.WEEKDAY_UNAVAILABLE, where: "date" });
        break;
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

  // Why a WEEKDAY date is closed: the first cart product (in bag order) that cannot be picked up that day.
  const weekdayReason = (date: string): string | undefined => {
    const wd = weekdayOf(date);
    const line = lines.find((l) => (l.product.pickupWeekdays?.length ?? 0) > 0 && !l.product.pickupWeekdays!.includes(wd));
    return line ? fill(t.stateWeekday, { name: line.product.name, days: weekdayList(line.product.pickupWeekdays!) }) : undefined;
  };
  const hintOption = hintDate ? data?.dates.find((d) => d.date === hintDate) : undefined;
  const hintRows =
    !splitPlan && hintOption && (hintOption.state === "FULL" || hintOption.state === "WEEKDAY") && hintOption.hints?.length ? (
      <HintRows option={hintOption} byId={byId} onReduce={applyReduce} onSplit={applySplit} />
    ) : null;
  const delivery = fulfillment === "DELIVERY";
  const dateError = submitError?.where === "date" ? submitError : null;
  const bottomError = submitError?.where === "submit" ? submitError : null;

  return (
    <Shell>
      {top}
      <main ref={pageRef} className="flex flex-1 flex-col px-5 pb-[calc(30px+env(safe-area-inset-bottom))]">
        {!orderingEnabled ? (
          <p className="mt-1 text-sm font-semibold text-c-red" data-testid="ordering-closed">
            {copy.home.orderingClosed}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="flex flex-col" noValidate>
          {splitPlan ? (
            <div className="mt-3 flex items-center gap-3 text-[13.5px] leading-snug font-semibold" data-testid="split-notice">
              <p className="min-w-0 flex-1">{fill(t.splitNotice, { n: pieceCount(splitPlan.rest) })}</p>
              <button
                type="button"
                className={`min-h-11 shrink-0 px-2 text-sm font-bold underline ${focusRing}`}
                data-testid="split-undo"
                onClick={() => {
                  setSplitPlan(null);
                  setSelectedDate(null);
                }}
              >
                {t.splitUndo}
              </button>
            </div>
          ) : null}

          {/* Cart lines */}
          <ul className="mt-3 flex flex-col divide-y divide-c-line" aria-label={t.cartTitle} data-rise="">
            {lines.map(({ productId, qty, product }) => {
              const problem = problems.get(productId);
              const unavailable = product.status === "PAUSED" || problem === "PRODUCT_UNAVAILABLE";
              const overLimit = problem === "QTY_LIMIT" || qty > menu.maxQtyPerItem;
              const atMax = qty >= menu.maxQtyPerItem;
              return (
                <li key={productId} className="flex items-center gap-3 py-3" data-testid="cart-line" data-product-id={productId}>
                  <ProductPhoto
                    product={product}
                    variant="thumb"
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-[14px] ${unavailable ? "opacity-50 grayscale" : ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug font-bold break-words">{product.name}</p>
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
                      disabled={submitting}
                      onClick={() => cart.remove(productId)}
                    >
                      {t.remove}
                    </button>
                  ) : splitPlan ? null : (
                    <Stepper
                      size="md"
                      tone="wash"
                      qty={qty}
                      canIncrease={!atMax && !submitting}
                      canDecrease={qty > 0 && !submitting}
                      decreaseLabel={fill(bagCopy.decreaseNamed, { name: product.name })}
                      increaseLabel={fill(bagCopy.increaseNamed, { name: product.name })}
                      qtyLabel={fill(bagCopy.qtyNamed, { name: product.name, qty })}
                      qtyTestId="qty"
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
            note={leadHint}
            noteTestId="lead-hint"
            testId="dates"
          >
            {data ? (
              data.dates.length === 0 ? (
                <p className="text-sm text-c-grey" data-testid="no-dates">
                  {t.noDates}
                </p>
              ) : (
                <div className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-2.5 overflow-x-auto px-5 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {data.dates.map((d) => (
                    <DateCard
                      key={d.date}
                      option={d}
                      selected={selectedDate === d.date || hintDate === d.date}
                      reduced={reduced}
                      reason={d.state === "WEEKDAY" ? weekdayReason(d.date) : undefined}
                      onSelect={() => {
                        setSubmitError(null);
                        if (d.state === "AVAILABLE") {
                          setSelectedDate(d.date);
                          setHintDate(null);
                        } else {
                          setHintDate(d.date);
                        }
                      }}
                    />
                  ))}
                </div>
              )
            ) : avail.status === "error" ? null : (
              <DatesSkeleton />
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
                {hintRows}
                {dateError.suggestion && !hintRows ? (
                  <button
                    type="button"
                    className={`mt-2 min-h-11 rounded-full border-[1.5px] border-c-red px-4 text-sm font-bold text-c-red ${focusRing}`}
                    data-testid="suggestion"
                    onClick={() => {
                      setSelectedDate(dateError.suggestion!);
                      setHintDate(null);
                      setSubmitError(null);
                    }}
                  >
                    {fill(t.switchDate, { day: safeDayLabel(dateError.suggestion) })}
                  </button>
                ) : null}
              </FieldError>
            ) : null}
            {!dateError && hintRows ? (
              <div role="status" className="mt-2.5 text-[13.5px] leading-snug font-semibold text-c-red" data-testid="hints">
                {hintRows}
              </div>
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
                    className={`relative flex cursor-pointer items-center justify-center rounded-[14px] text-base font-bold transition-colors duration-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-current ${checked ? "text-c-ink" : "text-c-grey"}`}
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
              className="w-full rounded-none border-0 border-b-2 border-c-line bg-transparent pt-2 pb-2.5 text-[21px] leading-[1.3] font-semibold text-c-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-medium placeholder:text-c-grey focus:border-c-ink focus:shadow-[0_1px_0_0_var(--c-ink)] aria-[invalid=true]:border-c-red aria-[invalid=true]:shadow-[0_1px_0_0_var(--c-red)]"
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
            {note.length >= NOTE_COUNTER_FROM ? (
              <p className="mt-1.5 text-right text-xs text-c-grey tabular-nums" data-testid="note-counter">
                {fill(t.noteCounter, { count: note.length, max: NOTE_MAX })}
              </p>
            ) : null}
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
              <div className="ui-skel h-12 rounded-2xl" aria-hidden="true" />
            )}
          </section>

          <p className="mt-3.5 mb-[18px] text-[13px] leading-normal text-c-grey">{t.payLater}</p>

          {bottomError ? <FieldError message={bottomError.message} seq={errorSeq} testId="submit-error" /> : null}
          {blockedReason ? (
            <p className="mt-3 text-[13.5px] leading-snug font-semibold text-c-red" data-testid="submit-blocked">
              {blockedReason}
            </p>
          ) : null}

          <button
            type="submit"
            className={`mt-3 flex h-[58px] w-full items-center justify-center rounded-[29px] bg-c-ink text-base leading-none font-bold text-c-paper transition-transform duration-[180ms] active:scale-95 disabled:opacity-35 motion-reduce:active:scale-100 ${focusRing}`}
            disabled={submitting || !orderingEnabled || hasCartProblem}
            data-testid="submit"
          >
            {submitting ? t.submitting : t.submit}
          </button>
        </form>
      </main>
      <SiteFooter ownerWechatId={menu.ownerWechatId} />
      <AssistantEntry mode="checkout" products={menu.products} maxQty={menu.maxQtyPerItem} fulfillment={fulfillment} />
    </Shell>
  );
}
