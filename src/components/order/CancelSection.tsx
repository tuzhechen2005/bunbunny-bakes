"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/copy";

const t = copy.customer.order;

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
  if (!canCancel) return <p className="text-sm text-muted">{t.cancelClosed}</p>;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-lg bg-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        className="min-h-11 w-full rounded-full border border-line bg-card text-base text-ink active:bg-soft"
      >
        {t.cancelOrder}
      </button>
      {cancelDeadlineLabel && <p className="text-center text-sm text-muted">{cancelDeadlineLabel}</p>}

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40">
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
            className="relative w-full max-w-md rounded-t-2xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink"
          >
            <p id="cancel-sheet-title" className="mb-5 text-center font-serif text-lg">
              {t.cancelConfirmTitle}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="min-h-11 w-full rounded-full bg-danger text-base font-semibold text-accent-ink disabled:opacity-50"
              >
                {busy ? t.cancelling : t.cancelConfirm}
              </button>
              <button
                ref={backRef}
                type="button"
                onClick={() => setSheetOpen(false)}
                disabled={busy}
                className="min-h-11 w-full rounded-full border border-line text-base text-ink disabled:opacity-50"
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
