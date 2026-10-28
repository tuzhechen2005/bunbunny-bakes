"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import type { MenuProduct } from "@/lib/api";
import { ASSISTANT_MAX_CHARS, type AssistantSuggestion } from "@/lib/assistant";
import { CloseIcon } from "../bag/icons";
import { fill } from "../format";
import { IridescentOrb } from "./IridescentOrb";

const t = copy.customer.assistant;

export type ChatRow =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; suggestion?: AssistantSuggestion }
  | { role: "error"; content: string };

export interface AssistantSheetProps {
  rows: readonly ChatRow[];
  waiting: boolean;
  /** The daily limit was hit: no more questions today. */
  limited: boolean;
  hasCart: boolean;
  products: readonly MenuProduct[];
  onSend: (text: string) => void;
  onApply: (s: AssistantSuggestion, from: DOMRect | null) => void;
  onClosed: () => void;
}

function SuggestionCard({
  s,
  products,
  hasCart,
  onApply,
}: {
  s: AssistantSuggestion;
  products: readonly MenuProduct[];
  hasCart: boolean;
  onApply: (rect: DOMRect | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = s.items.filter((i) => byId.get(i.productId)?.status === "ACTIVE");
  if (lines.length === 0) return null;
  const date = s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? dayLabel(s.date) : null;
  const apply = (e: { currentTarget: HTMLElement }) => onApply(e.currentTarget.getBoundingClientRect());
  const btn = `flex h-11 items-center justify-center rounded-full px-5 text-[15px] font-bold ${focusRing}`;
  return (
    <div className="mt-2 rounded-2xl border border-c-line bg-c-paper p-4" data-testid="assistant-suggestion">
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[15px] font-bold">
        {lines.map((i) => (
          <li key={i.productId}>{fill(t.itemLine, { name: byId.get(i.productId)!.name, qty: i.qty })}</li>
        ))}
      </ul>
      {date ? <p className="mt-2 text-sm font-semibold">{fill(t.dateLine, { date })}</p> : null}
      {s.note ? <p className="mt-1.5 text-[13.5px] leading-snug break-words [overflow-wrap:anywhere] text-c-grey">{s.note}</p> : null}
      {asking ? (
        <div className="mt-3" data-testid="assistant-replace">
          <p className="text-sm font-bold">{t.replaceAsk}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={`${btn} bg-c-ink text-c-paper`} onClick={apply} data-testid="assistant-replace-yes">
              {t.replaceYes}
            </button>
            <button type="button" className={`${btn} bg-c-wash text-c-ink`} onClick={() => setAsking(false)}>
              {t.replaceNo}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${btn} mt-3 w-full bg-c-ink text-c-paper`}
          onClick={(e) => (hasCart ? setAsking(true) : apply(e))}
          data-testid="assistant-apply"
        >
          {t.apply}
        </button>
      )}
    </div>
  );
}

/** The 小小🐰 bottom sheet: opener line, chips, messages, input. Uses the shared Sheet. */
export function AssistantSheet({ rows, waiting, limited, hasCart, products, onSend, onApply, onClosed }: AssistantSheetProps) {
  const sheetRef = useRef<SheetHandle>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, waiting]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || waiting || limited) return;
    onSend(text);
    setText("");
  };

  return (
    <Sheet
      ref={sheetRef}
      label={t.name}
      onClosed={onClosed}
      history
      initialFocus={closeRef}
      className="h-[min(78svh,600px)]"
      panelTestId="assistant-sheet"
      backdropTestId="assistant-backdrop"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={() => sheetRef.current?.close()}
        aria-label={t.close}
        className={`absolute top-2.5 right-2.5 z-[3] grid size-11 place-items-center rounded-full text-c-ink ${focusRing}`}
        data-testid="assistant-close"
      >
        <CloseIcon className="size-5" />
      </button>
      <div className="flex shrink-0 items-center gap-3 px-5 pt-4 pr-16">
        <span className="shrink-0" data-testid="assistant-sheet-orb" data-thinking={waiting ? "1" : "0"}>
          <IridescentOrb size={44} thinking={waiting} />
        </span>
        <h2 className="font-display m-0 text-[26px] leading-[1.1] tracking-[-0.04em] text-c-ink">{t.name}</h2>
      </div>

      <div ref={listRef} data-sheet-scroll="" className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pt-3 pb-2" data-testid="assistant-list">
        <p className="text-[15px] leading-relaxed text-c-grey" data-testid="assistant-opener">
          {t.opener}
        </p>
        {rows.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="assistant-chips">
            {t.chips.map((c) => (
              <button
                key={c}
                type="button"
                className={`min-h-11 rounded-full bg-c-wash px-4 text-[14.5px] font-bold text-c-ink ${focusRing}`}
                onClick={() => onSend(c)}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-col gap-2.5" aria-live="polite">
          {rows.map((r, k) =>
            r.role === "user" ? (
              <p key={k} className="max-w-[85%] self-end rounded-2xl bg-c-ink px-4 py-2.5 text-[15px] leading-snug break-words [overflow-wrap:anywhere] whitespace-pre-wrap text-c-paper" data-testid="assistant-user">
                {r.content}
              </p>
            ) : r.role === "assistant" ? (
              <div key={k} className="max-w-[92%] self-start" data-testid="assistant-reply">
                <p className="rounded-2xl bg-c-wash px-4 py-2.5 text-[15px] leading-snug break-words [overflow-wrap:anywhere] whitespace-pre-wrap">{r.content}</p>
                {r.suggestion ? (
                  <SuggestionCard
                    s={r.suggestion}
                    products={products}
                    hasCart={hasCart}
                    onApply={(rect) => {
                      onApply(r.suggestion!, rect);
                      sheetRef.current?.close();
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <p key={k} className="self-start text-sm leading-snug font-semibold text-c-grey" role="status" data-testid="assistant-error">
                {r.content}
              </p>
            ),
          )}
          {waiting ? (
            <p className="self-start rounded-2xl bg-c-wash px-4 py-3 text-c-grey" data-testid="assistant-typing" role="status">
              <span className="sr-only">{t.typing}</span>
              <span aria-hidden="true" className="flex gap-1.5 motion-safe:animate-pulse">
                <i className="size-1.5 rounded-full bg-current" />
                <i className="size-1.5 rounded-full bg-current" />
                <i className="size-1.5 rounded-full bg-current" />
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={submit} className="shrink-0 px-5 pt-2 pb-[calc(14px+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={ASSISTANT_MAX_CHARS}
            disabled={limited}
            aria-label={t.inputLabel}
            placeholder={t.inputPlaceholder}
            enterKeyHint="send"
            autoComplete="off"
            className={`h-11 min-w-0 flex-1 rounded-full bg-c-wash px-4 text-base text-c-ink placeholder:text-c-grey disabled:opacity-50 ${focusRing}`}
            data-testid="assistant-input"
          />
          <button
            type="submit"
            disabled={!text.trim() || waiting || limited}
            className={`h-11 shrink-0 rounded-full bg-c-ink px-5 text-[15px] font-bold text-c-paper disabled:opacity-35 ${focusRing}`}
            data-testid="assistant-send"
          >
            {t.send}
          </button>
        </div>
        <p className="mt-2 text-xs leading-snug text-c-grey">{t.privacy}</p>
      </form>
    </Sheet>
  );
}
