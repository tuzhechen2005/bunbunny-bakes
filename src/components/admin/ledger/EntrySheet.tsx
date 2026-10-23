"use client";

import { useState, type FormEvent } from "react";
import { dangerBtn, inputClass, primaryBtn, secondaryBtn, Sheet } from "@/components/admin/orders/shared";
import { centsToDollarInput, parseDollarsToCents } from "@/components/admin/products/money";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { isLocalDate } from "@/domain/dates";
import { LEDGER_METHODS, type LedgerManualEntry, type LedgerMethod } from "@/domain/ledger";
import { formatCents } from "@/domain/pricing";
import { adminApi } from "@/lib/adminApi";

const t = copy.admin.ledger;

export interface ProductOption {
  id: string;
  name: string;
}

interface Row {
  key: number;
  /** A product id, or "" for a free-text name. */
  productId: string;
  name: string;
  qty: string;
}

let rowKey = 0;
const newRow = (over: Partial<Row> = {}): Row => ({ key: ++rowKey, productId: "", name: "", qty: "1", ...over });

const qtyClass = `${inputClass.replace("w-full", "")} w-16 shrink-0`;
const labelClass = "mb-1 block text-sm font-medium";

/** Add / edit form. `entry` set = edit; otherwise a new entry on `defaultDate`. */
export function EntryFormSheet({
  entry,
  defaultDate,
  products,
  onClose,
  onSaved,
}: Readonly<{
  entry: LedgerManualEntry | null;
  defaultDate: string;
  products: ProductOption[];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [date, setDate] = useState(entry?.date ?? defaultDate);
  const [amount, setAmount] = useState(entry ? centsToDollarInput(entry.amountCents) : "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [method, setMethod] = useState<LedgerMethod>(entry?.paidMethod ?? "WECHAT");
  const [rows, setRows] = useState<Row[]>(
    (entry?.items ?? []).map((i) => newRow({ productId: i.productId ?? "", name: i.name, qty: String(i.qty) })),
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const known = new Set(products.map((p) => p.id));
  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!isLocalDate(date)) next.date = t.errDate;
    const cents = parseDollarsToCents(amount);
    if (!cents.ok || cents.cents < 1) next.amount = t.errAmount;
    const trimmed = note.trim();
    if (trimmed.length < 1 || [...trimmed].length > 100) next.note = t.errNote;
    const items: { productId?: string; name?: string; qty: number }[] = [];
    for (const r of rows) {
      const qty = /^\d{1,3}$/.test(r.qty.trim()) ? Number(r.qty) : 0;
      const name = r.name.trim();
      // A linked row keeps its product even when the product is not in the dropdown
      // (archived, or the list did not load); the server checks it exists. Deleted
      // products already come back with no productId.
      const linked = r.productId !== "";
      if (qty < 1 || qty > 999 || (!linked && (name.length < 1 || name.length > 60))) {
        next.items = t.errItems;
        break;
      }
      items.push(linked ? { productId: r.productId, qty } : { name, qty });
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !cents.ok) return;

    setBusy(true);
    const body = { date, amountCents: cents.cents, note: trimmed, paidMethod: method, items };
    const result = entry
      ? await adminApi(`/api/admin/ledger/manual/${entry.id}`, { method: "PATCH", body })
      : await adminApi("/api/admin/ledger/manual", { method: "POST", body });
    setBusy(false);
    if (result.ok) {
      onSaved();
    } else if (result.error !== "UNAUTHORIZED") {
      setErrors({ form: result.message || t.saveFailed });
    }
  }

  return (
    <Sheet title={entry ? t.formEditTitle : t.formAddTitle} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="ledger-form">
        <div>
          <label htmlFor="ledger-date" className={labelClass}>
            {t.date}
          </label>
          <input
            id="ledger-date"
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {errors.date && <p className="mt-1 text-sm text-danger">{errors.date}</p>}
        </div>
        <div>
          <label htmlFor="ledger-amount" className={labelClass}>
            {t.amount}
          </label>
          <input
            id="ledger-amount"
            inputMode="decimal"
            className={inputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {errors.amount && <p className="mt-1 text-sm text-danger">{errors.amount}</p>}
        </div>
        <div>
          <label htmlFor="ledger-note" className={labelClass}>
            {t.note}
          </label>
          <input
            id="ledger-note"
            className={inputClass}
            placeholder={t.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {errors.note && <p className="mt-1 text-sm text-danger">{errors.note}</p>}
        </div>
        <div>
          <label htmlFor="ledger-method" className={labelClass}>
            {t.method}
          </label>
          <select
            id="ledger-method"
            className={inputClass}
            value={method}
            onChange={(e) => setMethod(e.target.value as LedgerMethod)}
          >
            {LEDGER_METHODS.map((m) => (
              <option key={m} value={m}>
                {t.methods[m]}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>{t.items}</legend>
          {rows.map((r, idx) => {
            const linked = r.productId !== "";
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-2" data-testid="ledger-item-row">
                <select
                  aria-label={t.itemProduct}
                  className={`${inputClass} min-w-0 flex-[1_1_0%]`}
                  value={r.productId}
                  onChange={(e) => updateRow(r.key, { productId: e.target.value })}
                  data-testid={`ledger-item-product-${idx}`}
                >
                  <option value="">{t.itemOther}</option>
                  {linked && !known.has(r.productId) && <option value={r.productId}>{r.name}</option>}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t.itemQty}
                  inputMode="numeric"
                  className={qtyClass}
                  value={r.qty}
                  onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                  data-testid={`ledger-item-qty-${idx}`}
                />
                <button
                  type="button"
                  className={`${secondaryBtn} shrink-0 px-3`}
                  aria-label={t.removeItem}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  ×
                </button>
                {!linked && (
                  <input
                    aria-label={t.itemName}
                    placeholder={t.itemName}
                    className={`${inputClass} basis-full`}
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    data-testid={`ledger-item-name-${idx}`}
                  />
                )}
              </div>
            );
          })}
          {errors.items && <p className="text-sm text-danger">{errors.items}</p>}
          <button
            type="button"
            className={`${secondaryBtn} self-start`}
            onClick={() => setRows((rs) => [...rs, newRow({ productId: products[0]?.id ?? "" })])}
          >
            {t.addItem}
          </button>
        </fieldset>
        {errors.form && (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={`${primaryBtn} flex-1`} disabled={busy}>
            {busy ? t.saving : t.save}
          </button>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function DeleteSheet({
  entry,
  onClose,
  onDeleted,
}: Readonly<{ entry: LedgerManualEntry; onClose: () => void; onDeleted: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await adminApi(`/api/admin/ledger/manual/${entry.id}`, { method: "DELETE" });
    setBusy(false);
    if (result.ok) onDeleted();
    else if (result.error !== "UNAUTHORIZED") setError(result.message || t.saveFailed);
  }

  return (
    <Sheet title={t.deleteTitle} onClose={onClose} busy={busy}>
      <p className="mb-4 break-words text-base">
        {fill(t.deleteBody, { date: entry.date, amount: formatCents(entry.amountCents), note: entry.note })}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={`${dangerBtn} flex-1`} onClick={confirm} disabled={busy}>
          {busy ? t.deleting : t.deleteYes}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
          {t.cancel}
        </button>
      </div>
    </Sheet>
  );
}
