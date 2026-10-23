"use client";

import type { CSSProperties } from "react";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill, type OrderViewData } from "./types";
import "./receipt.css";

const t = copy.customer.order;

/**
 * The order as a thermal receipt (FRONTEND.md 4.5). With `fresh` (just ordered, ?new=1) it prints
 * line by line from the top and a caramel stamp slams on; reduced motion shows it all at once.
 * `fresh` is read once by the parent, so the animation only ever plays on the first render.
 */
export function Receipt({ order, fresh }: { order: OrderViewData; fresh: boolean }) {
  const { reduced } = useMotionPrefs();
  const print = fresh && !reduced;
  const showStamp = fresh && order.statusKind !== "CANCELLED";

  // Lines are numbered in reading order; the stagger is capped so the whole print is about 0.9 s.
  let n = 0;
  const line = (): CSSProperties => ({ ["--i" as string]: n++ });
  const lineCount = 5 + order.items.length + (order.note ? 1 : 0) + (showStamp ? 1 : 0);
  const rootStyle = { ["--step" as string]: `${Math.min(0.08, 0.8 / lineCount).toFixed(3)}s` } as CSSProperties;

  return (
    <section
      data-testid="receipt"
      data-print={print ? "on" : "off"}
      style={rootStyle}
      className="receipt px-5 pt-5 text-base text-ink"
    >
      <div className="receipt-line flex flex-col items-center gap-1 pb-3 text-center" style={line()}>
        <BunnyMark size={32} color="var(--caramel)" />
        <p className="font-serif text-lg">{copy.shopName}</p>
      </div>

      {showStamp && (
        <div
          aria-hidden="true"
          data-testid="receipt-stamp"
          className="receipt-stamp rounded-md border-[3px] border-accent px-3 py-1 font-serif text-2xl tracking-widest text-accent"
        >
          {t.stamp}
        </div>
      )}

      <div className="receipt-line flex flex-col gap-1 border-y border-dashed border-line py-3" style={line()}>
        <p className="text-sm text-muted">{fill(t.orderNo, { orderNo: order.orderNo })}</p>
        <p className="font-medium">{fill(t.pickupDate, { pickupDateLabel: order.pickupDateLabel })}</p>
        <p>{order.fulfillment === "DELIVERY" ? t.delivery : t.pickup}</p>
        {order.fulfillment === "PICKUP" && order.pickupNote && (
          <p className="text-sm text-muted">{order.pickupNote}</p>
        )}
      </div>

      <div className="py-3">
        <h2 className="receipt-line mb-2 text-sm text-muted" style={line()}>
          {t.itemsTitle}
        </h2>
        <ul className="flex flex-col gap-2">
          {order.items.map((item, i) => (
            <li key={i} className="receipt-line flex justify-between gap-3" style={line()}>
              <span className="min-w-0 break-words">{fill(t.itemLine, { name: item.name, qty: item.qty })}</span>
              <span className="shrink-0 tabular-nums">{formatCents(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="receipt-line flex flex-col gap-1 border-t border-dashed border-line py-3" style={line()}>
        <div className="flex justify-between">
          <dt className="text-muted">{t.subtotal}</dt>
          <dd className="tabular-nums">{formatCents(order.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">{t.deliveryFee}</dt>
          <dd className="tabular-nums">{formatCents(order.deliveryFeeCents)}</dd>
        </div>
        <div className="flex justify-between font-serif text-xl">
          <dt>{t.total}</dt>
          <dd data-testid="total" className="tabular-nums">
            {formatCents(order.totalCents)}
          </dd>
        </div>
      </dl>

      {order.note && (
        <p
          className="receipt-line break-words border-t border-dashed border-line py-3 text-sm text-muted"
          style={line()}
        >
          {fill(t.note, { note: order.note })}
        </p>
      )}

      <p
        className="receipt-line border-t border-dashed border-line py-3 text-center text-sm text-muted"
        style={line()}
      >
        {t.payOnReceipt}
      </p>

      {showStamp && (
        <p className="receipt-line pb-3 text-center font-serif text-base text-accent-strong" style={line()}>
          {t.queueLine}
        </p>
      )}
    </section>
  );
}
