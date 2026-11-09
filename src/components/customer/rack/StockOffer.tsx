"use client";

import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import type { MenuProduct } from "@/lib/api";
import { fill } from "../format";

const t = copy.customer.group;

export interface PublicLot {
  lotId: string;
  date: string;
  productId: string;
  flavorId: string | null;
  left: number;
  sellUntil: string;
}

let cached: { at: number; lots: Promise<PublicLot[]> } | null = null;
function openLots(): Promise<PublicLot[]> {
  if (!cached || Date.now() - cached.at > 30_000) {
    cached = {
      at: Date.now(),
      lots: fetch("/api/stock-lots", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { lots: [] }))
        .then((j: { lots?: PublicLot[] }) => j.lots ?? [])
        .catch(() => []),
    };
  }
  return cached.lots;
}

const untilLabel = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * D194 on the detail: 现货 of this bread (and the chosen flavour), each lot one row with its own add.
 * A 现货 line is its own cart line tied to the lot and its date; the server caps it at what is left.
 */
export function StockOffer({
  product,
  flavorId,
  inCart,
  onAdd,
}: Readonly<{
  product: MenuProduct;
  flavorId: string | null;
  inCart: (lotId: string) => number;
  onAdd: (lot: PublicLot, from: DOMRect) => void;
}>) {
  const [lots, setLots] = useState<PublicLot[]>([]);
  useEffect(() => {
    let live = true;
    void openLots().then((l) => live && setLots(l));
    return () => {
      live = false;
    };
  }, []);
  const needFlavor = (product.flavors?.length ?? 0) > 0;
  const mine = lots.filter((l) => l.productId === product.id && l.left > 0 && (!needFlavor || l.flavorId === flavorId));
  if (mine.length === 0) return null;
  return (
    <ul className="hm-dt-lead m-0 flex list-none flex-col gap-2" data-testid="detail-stock">
      {mine.map((l) => {
        const room = l.left - inCart(l.lotId);
        return (
          <li key={l.lotId} className="flex items-center justify-between gap-3">
            <span>
              <b>{t.stockTag}</b> · {dayLabel(l.date)} · {fill(t.stockLeft, { n: l.left })} · {fill(t.stockUntil, { time: untilLabel(l.sellUntil) })}
            </span>
            <button
              type="button"
              className="hm-stock-add"
              disabled={room <= 0}
              onClick={(e) => onAdd(l, e.currentTarget.getBoundingClientRect())}
              data-testid="detail-stock-add"
            >
              {t.stockAdd}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
