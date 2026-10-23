"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copy } from "@/copy";
import { copyText } from "./copyText";

const t = copy.customer.order;
const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";

interface Props {
  token: string;
  /** Closes only through the "我已保存" button (D83). */
  onDone: () => void;
  /** The page behind the dialog; made inert while it is open. */
  backgroundRef: React.RefObject<HTMLElement | null>;
}

/**
 * Save-link modal shown once after ordering (D83, PAGES.md). A real dialog: focus starts on the
 * big button and never leaves; backdrop click and Esc do nothing; only "我已保存" closes it.
 * If copying fails the link is shown in a selectable field.
 */
export function SaveLinkModal({ token, onDone, backgroundRef }: Props) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [link] = useState(() => `${window.location.origin}/o/${encodeURIComponent(token)}`);
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const background = backgroundRef.current;
    background?.setAttribute("inert", "");
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    copyRef.current?.focus();
    return () => {
      background?.removeAttribute("inert");
      document.body.style.overflow = overflow;
      clearTimeout(resetTimer.current);
    };
  }, [backgroundRef]);

  // Select the link as soon as the fallback field appears, so one long-press copies it.
  useEffect(() => {
    if (failed) linkRef.current?.select();
  }, [failed]);

  const onCopy = useCallback(async () => {
    const ok = await copyText(link);
    clearTimeout(resetTimer.current);
    if (ok) {
      setFailed(false);
      setCopied(true);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } else {
      setCopied(false);
      setFailed(true);
    }
  }, [link]);

  // Document-level, so the trap also holds when focus has slipped to <body> (e.g. a tap on the backdrop).
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, input") ?? []);
      if (nodes.length === 0) return;
      // Always move focus ourselves: Safari's default Tab order skips buttons, and focus
      // must wrap inside the dialog in every browser.
      e.preventDefault();
      const at = nodes.findIndex((n) => n === document.activeElement);
      const next = e.shiftKey ? (at <= 0 ? nodes.length - 1 : at - 1) : at < 0 || at === nodes.length - 1 ? 0 : at + 1;
      nodes[next].focus();
    }
    function onFocusIn(e: FocusEvent) {
      if (e.target instanceof Node && !dialogRef.current?.contains(e.target)) copyRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  return createPortal(
    <div
      data-testid="save-modal-backdrop"
      // A tap on the backdrop must not pull focus out of the dialog.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      className="ord-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-c-ink/55 p-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:items-center"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-modal-title"
        aria-describedby="save-modal-hint"
        data-testid="save-modal"
        className="ord-modal w-full max-w-[400px] rounded-[28px] bg-c-paper p-6 text-c-ink"
      >
        <h2 id="save-modal-title" className="m-0 text-center font-display text-[26px] leading-[1.2] tracking-[-0.04em]">
          {t.saveTitle}
        </h2>
        <p id="save-modal-hint" className="mt-2.5 text-center text-[14.5px] leading-normal font-medium text-c-grey">
          {t.saveHint}
        </p>
        {failed && (
          <div className="mt-4" data-testid="save-link-fallback">
            <p role="alert" className="mb-2 text-center text-[13px] leading-normal text-c-grey">
              {t.saveCopyFailed}
            </p>
            <input
              ref={linkRef}
              readOnly
              value={link}
              aria-label={t.saveCopy}
              onFocus={(e) => e.currentTarget.select()}
              className={`w-full rounded-xl bg-c-wash px-3 py-2.5 text-base leading-normal text-c-ink select-all ${focusRing}`}
            />
          </div>
        )}
        <button
          ref={copyRef}
          type="button"
          data-testid="save-copy"
          onClick={onCopy}
          aria-live="polite"
          className={`mt-5 flex min-h-[58px] w-full items-center justify-center rounded-full bg-c-ink text-base font-bold text-c-paper transition-transform active:scale-[0.98] ${focusRing}`}
        >
          {copied ? t.saveCopied : t.saveCopy}
        </button>
        <button
          type="button"
          data-testid="save-done"
          onClick={onDone}
          className={`mt-2 flex min-h-12 w-full items-center justify-center rounded-full text-[15px] font-bold text-c-grey ${focusRing}`}
        >
          {t.saveDone}
        </button>
      </div>
    </div>,
    document.body,
  );
}
