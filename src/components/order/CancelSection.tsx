"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/copy";

const t = copy.customer.order;
const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";

type Props = {
  token: string;
  canCancel: boolean;
  cancelDeadlineLabel: string | null;
  /** Called after a successful cancel so the page re-fetches the order. */
  onCancelled: () => void;
  /** Called after a refused cancel (409) so the page picks up the current state. */
  onRefused: () => void;
};

/** Message for a refused cancel. Falls back to order-page wording, never the checkout wording. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (body.error === "CUTOFF_PASSED") return t.cancelClosed;
    if (body.error === "NOT_CANCELLABLE") return copy.errors.NOT_CANCELLABLE;
  } catch {
    // not JSON
  }
  return t.cancelFailed;
}

export function CancelSection({ token, canCancel, cancelDeadlineLabel, onCancelled, onRefused }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Move focus into the sheet when it opens, and back to the trigger when it closes.
  useEffect(() => {
    if (sheetOpen) backRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen || busy) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, busy]);

  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/o/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      if (response.ok) {
        setSheetOpen(false);
        onCancelled();
      } else {
        setSheetOpen(false);
        setError(await errorMessage(response));
        if (response.status === 409) onRefused();
      }
    } catch {
      setSheetOpen(false);
      setError(t.cancelFailed);
    }
    setBusy(false);
  }

  // Not cancellable: the closed message says it all (no duplicated alert after a 409).
  if (!canCancel) return <p className="text-center text-[13px] leading-relaxed text-c-grey">{t.cancelClosed}</p>;

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {error && (
        <p role="alert" className="rounded-xl bg-c-paper p-3 text-sm font-semibold text-c-red">
          {error}
        </p>
      )}
      {cancelDeadlineLabel && <p className="text-[13px] leading-relaxed text-c-grey">{cancelDeadlineLabel}</p>}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        className={`min-h-11 px-4 text-[13px] font-semibold text-c-ink underline underline-offset-[3px] ${focusRing}`}
      >
        {t.cancelOrder}
      </button>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-c-ink/40">
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 cursor-default"
            onClick={() => !busy && setSheetOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-sheet-title"
            className="relative w-full max-w-[430px] rounded-t-[24px] bg-c-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-c-ink"
          >
            <p id="cancel-sheet-title" className="mb-5 text-center font-display text-lg">
              {t.cancelConfirmTitle}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={`min-h-[52px] w-full rounded-full bg-c-red text-base font-bold text-c-paper disabled:opacity-50 ${focusRing}`}
              >
                {busy ? t.cancelling : t.cancelConfirm}
              </button>
              <button
                ref={backRef}
                type="button"
                onClick={() => setSheetOpen(false)}
                disabled={busy}
                className={`min-h-[52px] w-full rounded-full border-[1.5px] border-c-ink text-base font-bold text-c-ink disabled:opacity-50 ${focusRing}`}
              >
                {t.cancelBack}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
