"use client";

import { useState } from "react";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { AdminCard } from "../AdminCard";

const t = copy.admin.dashboard;

/** Big on/off button. Pausing asks for confirmation in an in-page sheet. */
export function OrderingSwitch({
  enabled,
  onChanged,
}: Readonly<{ enabled: boolean; onChanged: (enabled: boolean) => void }>) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(next: boolean) {
    setPending(true);
    setError(null);
    const result = await adminApi<{ orderingEnabled: boolean }>("/api/admin/ordering", {
      body: { enabled: next },
    });
    setPending(false);
    if (result.ok) {
      setConfirming(false);
      onChanged(result.data.orderingEnabled);
    } else {
      setError(result.message);
    }
  }

  const label = enabled ? (pending ? t.turningOff : t.turnOff) : pending ? t.turningOn : t.turnOn;

  return (
    <AdminCard>
      <p className="mb-3 text-base font-medium" data-testid="ordering-state">
        {enabled ? t.orderingOn : t.orderingOff}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => (enabled ? setConfirming(true) : void send(true))}
        className={`min-h-14 w-full rounded-xl text-lg font-semibold disabled:bg-disabled disabled:text-disabled-ink ${
          enabled ? "border border-danger text-danger" : "bg-accent text-accent-ink"
        }`}
      >
        {label}
      </button>
      {error && !confirming && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => !pending && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-title"
            className="w-full rounded-t-2xl bg-card p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pause-title" className="font-serif text-lg font-semibold">
              {t.pauseConfirmTitle}
            </h2>
            <p className="mt-2 text-base text-muted">{t.pauseConfirmBody}</p>
            {error && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="min-h-12 flex-1 rounded-xl border border-line text-base disabled:text-disabled-ink"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void send(false)}
                className="min-h-12 flex-1 rounded-xl bg-danger text-base font-semibold text-accent-ink disabled:bg-disabled disabled:text-disabled-ink"
              >
                {pending ? t.turningOff : t.pauseConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminCard>
  );
}
