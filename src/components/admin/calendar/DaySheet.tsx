"use client";

import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { dayLabel } from "@/domain/dates";
import { adminApi } from "@/lib/adminApi";
import type { CalendarDay, DateWarning } from "@/server/calendar";

const t = copy.admin.calendar;

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-foreground";

/** "" -> null; digits -> int; anything else -> undefined (invalid). */
function parseLimit(s: string): number | null | undefined {
  const v = s.trim();
  if (v === "") return null;
  return /^\d{1,7}$/.test(v) ? Number(v) : undefined;
}

export function DaySheet({
  day,
  products,
  onClose,
  onSaved,
}: Readonly<{
  day: CalendarDay;
  products: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [isOpen, setIsOpen] = useState(day.isOpen);
  const [dough, setDough] = useState(day.overrides.doughLimitG?.toString() ?? "");
  const [deliveryEnabled, setDeliveryEnabled] = useState(day.limits.deliveryEnabled);
  const [delivery, setDelivery] = useState(day.overrides.deliveryLimit?.toString() ?? "");
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(products.map((p) => [p.id, day.overrides.productLimits[p.id]?.toString() ?? ""])),
  );
  const [note, setNote] = useState(day.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<DateWarning[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const names = Object.fromEntries(products.map((p) => [p.id, p.name]));

  async function submit(confirm: boolean) {
    if (pending) return;
    const doughV = parseLimit(dough);
    const deliveryV = parseLimit(delivery);
    const productV: Record<string, number | null> = {};
    let invalid = doughV === undefined || deliveryV === undefined;
    for (const p of products) {
      const v = parseLimit(limits[p.id] ?? "");
      if (v === undefined) invalid = true;
      else productV[p.id] = v;
    }
    if (invalid) {
      setError(t.limitInvalid);
      return;
    }
    setPending(true);
    setError(null);
    const result = await adminApi(`/api/admin/dates/${day.date}`, {
      method: "PUT",
      body: {
        isOpen,
        doughLimitG: doughV,
        deliveryEnabled,
        deliveryLimit: deliveryV,
        productLimits: productV,
        note: note.trim() === "" ? null : note,
        ...(confirm ? { confirm: true } : {}),
      },
    });
    setPending(false);
    if (result.ok) {
      onSaved();
      return;
    }
    if (result.error === "OVER_LIMIT" && Array.isArray(result.warnings)) {
      setWarnings(result.warnings as DateWarning[]);
      return;
    }
    setError(result.message);
  }

  function warningText(w: DateWarning): string {
    if (w.kind === "HAS_ORDERS") return fill(t.warnHasOrders, { count: w.count });
    if (w.what === "PRODUCT") {
      return fill(t.warnProduct, { name: names[w.productId] ?? "", limit: w.limit, used: w.used });
    }
    return fill(w.what === "DOUGH" ? t.warnDough : t.warnDelivery, { limit: w.limit, used: w.used });
  }

  const label = "mb-1 block text-sm text-muted";
  const toggleRow = "flex min-h-11 items-center gap-3 text-base";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={dayLabel(day.date)}
        className="max-h-[90dvh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{dayLabel(day.date)}</h2>
          <button type="button" className="min-h-11 min-w-11 text-muted" onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        </div>

        <label className={toggleRow}>
          <input type="checkbox" className="size-6" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} />
          {t.isOpen}
        </label>

        <div>
          <label className={label} htmlFor="cal-dough">{t.doughLimit}</label>
          <input
            id="cal-dough"
            className={inputClass}
            inputMode="numeric"
            value={dough}
            placeholder={String(day.limits.doughLimitG === day.overrides.doughLimitG ? "" : day.limits.doughLimitG)}
            onChange={(e) => setDough(e.target.value)}
          />
        </div>

        {products.map((p) => (
          <div key={p.id}>
            <label className={label} htmlFor={`cal-p-${p.id}`}>{fill(t.productLimit, { name: p.name })}</label>
            <input
              id={`cal-p-${p.id}`}
              className={inputClass}
              inputMode="numeric"
              value={limits[p.id] ?? ""}
              placeholder={day.overrides.productLimits[p.id] === null ? String(day.limits.productLimits[p.id] ?? "") : ""}
              onChange={(e) => setLimits({ ...limits, [p.id]: e.target.value })}
            />
          </div>
        ))}

        <label className={toggleRow}>
          <input
            type="checkbox"
            className="size-6"
            checked={deliveryEnabled}
            onChange={(e) => setDeliveryEnabled(e.target.checked)}
          />
          {t.deliveryEnabled}
        </label>
        <div>
          <label className={label} htmlFor="cal-delivery">{t.deliveryLimit}</label>
          <input
            id="cal-delivery"
            className={inputClass}
            inputMode="numeric"
            value={delivery}
            disabled={!deliveryEnabled}
            placeholder={day.overrides.deliveryLimit === null ? String(day.limits.deliveryLimit) : ""}
            onChange={(e) => setDelivery(e.target.value)}
          />
        </div>

        <div>
          <label className={label} htmlFor="cal-note">{t.note}</label>
          <input
            id="cal-note"
            className={inputClass}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {warnings && (
          <div role="alert" className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
            <p className="font-medium">{t.warnTitle}</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{warningText(w)}</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={pending}
                className="min-h-11 flex-1 rounded-lg bg-danger px-3 text-base font-medium text-white disabled:opacity-60"
                onClick={() => void submit(true)}
              >
                {pending ? t.saving : t.saveAnyway}
              </button>
              <button
                type="button"
                disabled={pending}
                className="min-h-11 flex-1 rounded-lg border border-line bg-card px-3 text-base text-foreground"
                onClick={() => setWarnings(null)}
              >
                {t.cancelWarning}
              </button>
            </div>
          </div>
        )}

        {!warnings && (
          <button
            type="submit"
            disabled={pending}
            className="min-h-12 w-full rounded-lg bg-accent px-4 text-base font-medium text-accent-ink disabled:bg-disabled disabled:text-disabled-ink"
          >
            {pending ? t.saving : t.save}
          </button>
        )}
      </form>
    </div>
  );
}
