"use client";

import { useState } from "react";
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

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.error === "string" && body.error in copy.errors) {
      return copy.errors[body.error as keyof typeof copy.errors];
    }
  } catch {
    // not JSON
  }
  return t.cancelFailed;
}

export function CancelSection({ token, canCancel, cancelDeadlineLabel, onCancelled, onRefused }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!canCancel) {
    return (
      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <p className="text-sm text-neutral-600">{t.cancelClosed}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white text-base text-neutral-700"
      >
        {t.cancelOrder}
      </button>
      {cancelDeadlineLabel && <p className="text-center text-sm text-neutral-500">{cancelDeadlineLabel}</p>}

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
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
            className="relative w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <p id="cancel-sheet-title" className="mb-5 text-center text-lg font-semibold">
              {t.cancelConfirmTitle}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="min-h-11 w-full rounded-lg bg-red-600 text-base font-medium text-white disabled:opacity-50"
              >
                {busy ? t.cancelling : t.cancelConfirm}
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                disabled={busy}
                className="min-h-11 w-full rounded-lg border border-neutral-300 text-base text-neutral-700 disabled:opacity-50"
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
