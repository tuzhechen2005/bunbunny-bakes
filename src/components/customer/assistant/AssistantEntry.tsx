"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import type { Fulfillment, MenuProduct } from "@/lib/api";
import { askAssistant, ASSISTANT_MAX_CHARS, type AssistantMessage, type AssistantSuggestion } from "@/lib/assistant";
import { cart, setPreferredDate, useCart } from "@/lib/cart";
import { flyToBag, getBagTargetRect } from "@/lib/flyToBag";
import { AssistantSheet, type ChatRow } from "./AssistantSheet";
import { IridescentOrb } from "./IridescentOrb";
import { useTeaser } from "./AssistantTeaser";

const t = copy.customer.assistant;

/** Orb size (px), and while a question shows beside it (D120). */
const ORB = 74;
const TEASE_ORB = 38;

export interface AssistantEntryProps {
  mode: "home" | "checkout";
  products: readonly MenuProduct[];
  maxQty: number;
  fulfillment?: Fulfillment;
  /** Home: the product detail is open, the button steps aside. */
  suppressed?: boolean;
}

/** True while the element is on screen; `depth` is how far up (fraction of the viewport) its top must have come. */
function inView(el: Element | null, depth = 1): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight * depth && r.height > 0;
}

/**
 * The glass-orb button and its sheet. Home: only while the 「全部面包」 section is on screen
 * (never over the hero), sitting above the bag bar. Checkout: bottom right, hidden while the submit
 * button is on screen so it never covers it. The conversation lives here, so it survives closing
 * the sheet; it is never stored.
 */
export function AssistantEntry({ mode, products, maxQty, fulfillment, suppressed }: AssistantEntryProps) {
  const pathname = usePathname();
  const items = useCart();
  const [near, setNear] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [limited, setLimited] = useState(false);
  const rowsRef = useRef(rows);
  const busy = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const onRoute = pathname === (mode === "home" ? "/" : "/checkout");

  useEffect(() => {
    if (!onRoute) return;
    const check = () => {
      // Home: the list's top has to come up the screen, so the hero's peek of it does not count.
      if (mode === "home") setNear(inView(document.getElementById("hm-list"), 0.7));
      else setNear(!inView(document.querySelector('[data-testid="submit"]')));
    };
    check();
    // Capture: the page may scroll inside an element rather than the window.
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);
    // The page content arrives after mount (menu, availability).
    const timer = setInterval(check, 400);
    return () => {
      window.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
      clearInterval(timer);
    };
  }, [mode, onRoute]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim().slice(0, ASSISTANT_MAX_CHARS);
      if (!content || busy.current || limited) return;
      busy.current = true;
      const next: ChatRow[] = [...rowsRef.current, { role: "user", content }];
      rowsRef.current = next;
      setRows(next);
      setWaiting(true);
      const history: AssistantMessage[] = [];
      for (const r of next) if (r.role === "user" || r.role === "assistant") history.push({ role: r.role, content: r.content });
      const result = await askAssistant({
        messages: history,
        cart: cart.getItems().map((i) => ({ productId: i.productId, qty: i.qty })),
        ...(fulfillment ? { fulfillment } : {}),
      });
      let added: ChatRow;
      if (result.ok) {
        added = { role: "assistant", content: result.data.reply, suggestion: result.data.suggestion };
      } else {
        if (result.kind === "limit") setLimited(true);
        added = { role: "error", content: result.kind === "limit" ? t.limit : t.unavailable };
      }
      rowsRef.current = [...rowsRef.current, added];
      setRows(rowsRef.current);
      setWaiting(false);
      busy.current = false;
    },
    [fulfillment, limited],
  );

  const apply = useCallback(
    (s: AssistantSuggestion, from: DOMRect | null) => {
      const known = new Map(products.map((p) => [p.id, p]));
      // Unknown / inactive products are dropped, duplicate lines merged, then each qty clamped to maxQty.
      const merged = new Map<string, number>();
      for (const i of s.items) {
        if (known.get(i.productId)?.status !== "ACTIVE" || !Number.isFinite(i.qty)) continue;
        merged.set(i.productId, (merged.get(i.productId) ?? 0) + Math.floor(i.qty));
      }
      const lines = [...merged].map(([productId, qty]) => ({ productId, qty: Math.max(1, Math.min(qty, maxQty)) }));
      if (lines.length === 0) return;
      // The date first: the checkout page reads it when the cart change makes it re-query.
      if (s.date) setPreferredDate(s.date);
      cart.replace(lines);
      if (from && getBagTargetRect()) {
        for (const l of lines) {
          flyToBag({ from, imageUrl: known.get(l.productId)?.imageUrl ?? null, productId: l.productId, count: l.qty });
        }
      }
    },
    [products, maxQty],
  );

  const visible = onRoute && near && !suppressed && !open;
  const teaser = useTeaser(visible, mode === "home" ? t.teasers : t.teasersCheckout);
  const question = teaser.question;

  return (
    <>
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-[47] mx-auto flex max-w-[430px] justify-end px-4 safe-x ${
          mode === "home"
            ? "pb-[calc(14px+60px+8px+env(safe-area-inset-bottom))]"
            : "pb-[calc(16px+env(safe-area-inset-bottom))]"
        } ${
          // Hiding: fade while the orb shrinks back to a point, and only then become invisible.
          visible
            ? "visible opacity-100 [transition:opacity_500ms,visibility_0s]"
            : "invisible opacity-0 [transition:opacity_450ms_ease-in_150ms,visibility_0s_linear_600ms]"
        }`}
        inert={!visible}
        data-testid="assistant-entry-wrap"
      >
        <button
          ref={opener}
          type="button"
          onClick={() => {
            teaser.used();
            setOpen(true);
            // A tap while a question shows asks that question (D120).
            if (question) void send(question);
          }}
          aria-label={question ?? t.entryAria}
          className={`pointer-events-auto flex items-center rounded-full p-[3px] origin-[calc(100%-40px)_50%] transition-[background-color,box-shadow,scale,translate] active:scale-[0.97] motion-reduce:transition-none ${
            visible
              ? "scale-100 duration-[300ms,300ms,900ms] ease-[ease,ease,cubic-bezier(0.22,1.2,0.36,1)]"
              : "scale-0 duration-[300ms,300ms,550ms] ease-[ease,ease,cubic-bezier(0.55,0,0.85,0.35)] motion-reduce:scale-100"
          } ${
            question ? "bg-c-ink/90 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/15" : "bg-transparent"
          } ${focusRing}`}
          data-testid="assistant-entry"
          data-teasing={question ? "1" : "0"}
        >
          {/* While a question shows, the orb shrinks to about half so the pill stays small; the canvas
              keeps its size and is scaled, so nothing is re-created. */}
          <span
            className="relative block shrink-0 overflow-visible transition-[width,height] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: question ? TEASE_ORB : ORB, height: question ? TEASE_ORB : ORB }}
          >
            <span
              className="absolute top-0 left-0 block origin-top-left transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={{ transform: `scale(${question ? TEASE_ORB / ORB : 1})` }}
            >
              <IridescentOrb size={ORB} />
            </span>
          </span>
          <span
            className={`overflow-hidden whitespace-nowrap transition-[max-width,padding] duration-500 ease-out motion-reduce:transition-none ${
              question ? "max-w-[min(250px,calc(100vw-100px))] pr-4 pl-2.5 text-ellipsis" : "max-w-0"
            }`}
          >
            <span key={question ?? ""} className="ao-shimmer block text-[15px] font-bold" data-testid="assistant-teaser">
              {question ?? ""}
            </span>
          </span>
        </button>
      </div>
      {open ? (
        <AssistantSheet
          rows={rows}
          waiting={waiting}
          limited={limited}
          hasCart={items.length > 0}
          products={products}
          onSend={send}
          onApply={apply}
          onClosed={() => {
            setOpen(false);
            opener.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </>
  );
}
