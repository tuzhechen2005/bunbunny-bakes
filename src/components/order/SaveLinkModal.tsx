"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { pendingSave } from "@/lib/pendingSave";
import { copyText } from "./copyText";

const t = copy.customer.order;

interface Props {
  token: string;
  /** Called after 我已保存 and the closing animation. */
  onDone: () => void;
  /** The page behind the dialog; made inert while it is open. */
  backgroundRef: React.RefObject<HTMLElement | null>;
}

/**
 * Save-link dialog shown after ordering (D83, D89, PAGES.md): the shared bottom sheet, but one that
 * cannot be dismissed. Focus starts on the big button and never leaves; backdrop, Esc and a pull
 * down do nothing; only "我已保存" closes it (and ends the reminder, see lib/pendingSave).
 * If copying fails the link is shown in a selectable field.
 */
export function SaveLinkModal({ token, onDone, backgroundRef }: Props) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [link] = useState(() => `${window.location.origin}/o/${encodeURIComponent(token)}`);
  const sheetRef = useRef<SheetHandle>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

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

  const saved = () => {
    pendingSave.clear(token);
    sheetRef.current?.close();
  };

  return (
    <Sheet
      ref={sheetRef}
      labelledBy="save-modal-title"
      describedBy="save-modal-hint"
      dismissible={false}
      initialFocus={copyRef}
      inertRef={backgroundRef}
      onClosed={onDone}
      className="p-6 pb-[calc(24px+env(safe-area-inset-bottom))]"
      panelTestId="save-modal"
      backdropTestId="save-modal-backdrop"
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
        onClick={saved}
        className={`mt-2 flex min-h-12 w-full items-center justify-center rounded-full text-[15px] font-bold text-c-grey ${focusRing}`}
      >
        {t.saveDone}
      </button>
    </Sheet>
  );
}
