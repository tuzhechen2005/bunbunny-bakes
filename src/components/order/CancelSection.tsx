"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { focusRing } from "@/components/ui/focus";
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
  const sheetRef = useRef<SheetHandle>(null);
  const wasOpen = useRef(false);

  // Focus goes back to the trigger when the sheet is gone (the sheet moves it inside when it opens).
  useEffect(() => {
    if (!sheetOpen && wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);

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
        <Sheet
          ref={sheetRef}
          labelledBy="cancel-sheet-title"
          dismissible={!busy}
          initialFocus={backRef}
          onClosed={() => setSheetOpen(false)}
          className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          panelTestId="cancel-sheet"
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
              onClick={() => sheetRef.current?.close()}
              disabled={busy}
              className={`min-h-[52px] w-full rounded-full border-[1.5px] border-c-ink text-base font-bold text-c-ink disabled:opacity-50 ${focusRing}`}
            >
              {t.cancelBack}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
