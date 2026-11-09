"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import type { Fulfillment } from "@/domain/types";
import { formatCents } from "@/domain/pricing";
import { fetchAvailability, submitOrder, uuidV4, type Availability } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { myOrders } from "@/lib/myOrders";
import { pendingSave } from "@/lib/pendingSave";

const t = copy.customer.assistant;
const c = copy.customer.checkout;
const WECHAT_MAX = 40;

/**
 * The 小小🐰 card as an order (owner 11/08, D191): the lines and date the assistant proposed, 自提/配送, the
 * total the server prices, and the customer's own WeChat ID, typed here and never sent to the assistant.
 * Only the customer's tap on 确认下单 places it, through the normal order endpoint (same capacity lock,
 * server pricing and idempotency as the checkout). Anything the server refuses is shown here, and
 * 先放进纸袋 hands over to the checkout as before.
 */
export function OrderCard({
  lines,
  date,
  initialFulfillment,
  onBag,
}: {
  lines: CartItem[];
  date: string;
  initialFulfillment: Fulfillment;
  onBag: (e: { currentTarget: HTMLElement }) => void;
}) {
  const router = useRouter();
  const [fulfillment, setFulfillment] = useState<Fulfillment>(initialFulfillment);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [wechatId, setWechatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const key = useRef(uuidV4());
  const busy = useRef(false);
  const linesKey = JSON.stringify(lines);

  useEffect(() => {
    let live = true;
    void fetchAvailability(JSON.parse(linesKey) as CartItem[], fulfillment).then((r) => {
      if (live) setAvail(r.ok ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [linesKey, fulfillment]);

  const day = avail?.dates.find((d) => d.date === date);
  const closed = avail !== null && (!avail.orderingEnabled || day?.state !== "AVAILABLE");
  const stateMessage = !avail
    ? null
    : !avail.orderingEnabled
      ? copy.errors.DATE_CLOSED
      : day?.state === "FULL"
        ? copy.errors.FULL_NO_SUGGESTION
        : day?.state === "DELIVERY_FULL"
          ? c.stateDeliveryFull
          : day?.state === "WEEKDAY"
            ? copy.errors.WEEKDAY_UNAVAILABLE
            : day?.state !== "AVAILABLE"
              ? copy.errors.CUTOFF_PASSED
              : null;

  async function place(e: FormEvent) {
    e.preventDefault();
    if (busy.current || closed || !avail) return;
    const id = wechatId.trim();
    if (!id) {
      setError(c.wechatRequired);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setError(null);
    const r = await submitOrder({
      items: lines.map(({ productId, qty, flavorId }) => (flavorId ? { productId, flavorId, qty } : { productId, qty })),
      pickupDate: date,
      fulfillment,
      wechatId: id.slice(0, WECHAT_MAX),
      note: "",
      idempotencyKey: key.current,
      website: "",
    });
    if (r.ok) {
      myOrders.record(r.data.viewToken, r.data.orderNo, Date.now());
      pendingSave.add(r.data.viewToken);
      router.push(`/o/${encodeURIComponent(r.data.viewToken)}?new=1`);
      return;
    }
    busy.current = false;
    setSubmitting(false);
    // No response: the order may exist; the same key retries it safely.
    const known = copy.errors as unknown as Record<string, unknown>;
    const text = known[r.error.error];
    setError(r.error.error === "NETWORK" ? copy.errors.fallback : typeof text === "string" ? text : (r.error.message ?? copy.errors.fallback));
  }

  const seg = (f: Fulfillment, label: string) => (
    <button
      type="button"
      aria-pressed={fulfillment === f}
      onClick={() => setFulfillment(f)}
      className={`h-9 flex-1 rounded-full text-sm font-bold ${fulfillment === f ? "bg-c-ink text-c-paper" : "text-c-ink"} ${focusRing}`}
      data-testid={`assistant-${f.toLowerCase()}`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={place} className="mt-3" data-testid="assistant-order">
      <div className="flex gap-1 rounded-full bg-c-wash p-1">
        {seg("PICKUP", c.pickup)}
        {seg("DELIVERY", c.delivery)}
      </div>
      {avail && !closed ? (
        <p className="mt-2.5 flex items-baseline justify-between text-sm" data-testid="assistant-total">
          <span className="text-c-grey">
            {avail.pricing.deliveryFeeCents > 0 ? `${c.deliveryFeeLabel} ${formatCents(avail.pricing.deliveryFeeCents)}` : ""}
          </span>
          <b className="font-num text-lg">{formatCents(avail.pricing.totalCents)}</b>
        </p>
      ) : null}
      {stateMessage ? (
        <p className="mt-2.5 text-sm font-semibold text-c-red" role="alert" data-testid="assistant-order-closed">
          {stateMessage}
        </p>
      ) : (
        <input
          name="wechatId"
          aria-label={c.wechatLabel}
          placeholder={t.wechatPlaceholder}
          value={wechatId}
          maxLength={WECHAT_MAX}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setWechatId(e.target.value);
            setError(null);
          }}
          className="mt-3 h-11 w-full rounded-xl border border-c-line bg-c-paper px-3.5 text-[16px] font-semibold text-c-ink outline-none focus:border-c-ink"
          data-testid="assistant-wechat"
        />
      )}
      {error ? (
        <p className="mt-2 text-sm font-semibold text-c-red" role="alert" data-testid="assistant-order-error">
          {error}
        </p>
      ) : null}
      {!closed ? (
        <button
          type="submit"
          disabled={!avail || submitting}
          className={`mt-3 flex h-11 w-full items-center justify-center rounded-full bg-c-ink px-5 text-[15px] font-bold text-c-paper disabled:opacity-40 ${focusRing}`}
          data-testid="assistant-place"
        >
          {submitting ? c.submitting : avail ? `${t.placeOrder} · ${formatCents(avail.pricing.totalCents)}` : t.placeOrder}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onBag}
        className={`mt-2 flex h-10 w-full items-center justify-center rounded-full text-sm font-bold text-c-grey ${focusRing}`}
        data-testid="assistant-apply"
      >
        {t.orBag}
      </button>
    </form>
  );
}
