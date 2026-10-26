"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { copy } from "@/copy";
import type { CapacityMode, ProductStatus } from "@/domain/types";
import { adminApi } from "@/lib/adminApi";
import { DEFAULT_FIELD_COLOR } from "@/lib/fieldColor";
import { fill, shortDate, type OverLimitDateDto, type ProductDto, type ProductImageDto } from "./describe";
import { ColorField } from "./ColorField";
import { PhotosField } from "./PhotosField";
import { centsToDollarInput, parseDollarsToCents } from "./money";

const t = copy.admin.products;

const inputClass =
  "w-full rounded-lg border border-line bg-card px-3 py-3 text-base focus:border-accent focus:outline-none";
const primaryButton =
  "min-h-12 w-full rounded-lg bg-accent px-4 text-base font-medium text-accent-ink disabled:bg-disabled disabled:text-disabled-ink";

const MODES: { value: CapacityMode; label: string; hint: string }[] = [
  { value: "DOUGH_PER_UNIT", label: t.modeUnitOption, hint: t.modeUnitHint },
  { value: "DOUGH_PER_ROUND", label: t.modeRoundOption, hint: t.modeRoundHint },
  { value: "INDEPENDENT", label: t.modeIndependentOption, hint: t.modeIndependentHint },
];
const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: "ACTIVE", label: t.statusActive },
  { value: "PAUSED", label: t.statusPaused },
  { value: "ARCHIVED", label: t.statusArchived },
];

interface FormState {
  name: string;
  description: string;
  unitPrice: string;
  bundleSize: string;
  bundlePrice: string;
  capacityMode: CapacityMode;
  doughG: string;
  roundG: string;
  piecesPerRound: string;
  dailyLimit: string;
  leadDays: string;
  batchYield: string;
  status: ProductStatus;
  fieldColor: string;
}

const str = (n: number | null) => (n === null ? "" : String(n));

function initialState(p?: ProductDto): FormState {
  if (!p) {
    return {
      name: "",
      description: "",
      unitPrice: "",
      bundleSize: "4",
      bundlePrice: "",
      capacityMode: "DOUGH_PER_UNIT",
      doughG: "",
      roundG: "",
      piecesPerRound: "",
      dailyLimit: "",
      leadDays: "1",
      batchYield: "",
      status: "ACTIVE",
      fieldColor: DEFAULT_FIELD_COLOR,
    };
  }
  return {
    name: p.name,
    description: p.description,
    unitPrice: centsToDollarInput(p.unitPriceCents),
    bundleSize: String(p.bundleSize),
    bundlePrice: p.bundlePriceCents === null ? "" : centsToDollarInput(p.bundlePriceCents),
    capacityMode: p.capacityMode,
    doughG: str(p.doughG),
    roundG: str(p.roundG),
    piecesPerRound: str(p.piecesPerRound),
    dailyLimit: str(p.dailyLimit),
    leadDays: String(p.leadDays),
    batchYield: str(p.batchYield),
    status: p.status,
    fieldColor: p.fieldColor ?? DEFAULT_FIELD_COLOR,
  };
}

type Errors = Partial<Record<keyof FormState, string>>;

/** Maps API field names (cents, etc.) to the form's field names. */
const API_FIELD_TO_FORM: Record<string, keyof FormState> = {
  name: "name",
  description: "description",
  unitPriceCents: "unitPrice",
  bundleSize: "bundleSize",
  bundlePriceCents: "bundlePrice",
  capacityMode: "capacityMode",
  doughG: "doughG",
  roundG: "roundG",
  piecesPerRound: "piecesPerRound",
  dailyLimit: "dailyLimit",
  leadDays: "leadDays",
  batchYield: "batchYield",
  status: "status",
  fieldColor: "fieldColor",
};

type Payload = Record<string, string | number | null>;

/** Validates what can be checked on the client; the server re-validates everything. */
function buildPayload(f: FormState, storedColor: string | null): { payload: Payload } | { errors: Errors } {
  const errors: Errors = {};
  const payload: Payload = { capacityMode: f.capacityMode, status: f.status };

  const name = f.name.trim();
  if (!name) errors.name = t.requiredField;
  payload.name = name;
  payload.description = f.description.trim();

  const intOf = (key: keyof FormState, required: boolean): number | null => {
    const raw = f[key].trim();
    if (!raw) {
      if (required) errors[key] = t.requiredField;
      return null;
    }
    if (!/^\d{1,9}$/.test(raw)) {
      errors[key] = t.intInvalid;
      return null;
    }
    return Number(raw);
  };

  const unit = parseDollarsToCents(f.unitPrice);
  if (unit.ok) payload.unitPriceCents = unit.cents;
  else errors.unitPrice = f.unitPrice.trim() ? t.moneyInvalid : t.requiredField;

  payload.bundleSize = intOf("bundleSize", true);
  if (f.bundlePrice.trim()) {
    const bundle = parseDollarsToCents(f.bundlePrice);
    if (bundle.ok) payload.bundlePriceCents = bundle.cents;
    else errors.bundlePrice = t.moneyInvalid;
  } else {
    payload.bundlePriceCents = null;
  }

  // Only the chosen mode's fields are sent with a value; the server nulls the rest anyway.
  payload.doughG = f.capacityMode === "DOUGH_PER_UNIT" ? intOf("doughG", true) : null;
  payload.roundG = f.capacityMode === "DOUGH_PER_ROUND" ? intOf("roundG", true) : null;
  payload.piecesPerRound = f.capacityMode === "DOUGH_PER_ROUND" ? intOf("piecesPerRound", true) : null;
  payload.dailyLimit = f.capacityMode === "INDEPENDENT" ? intOf("dailyLimit", true) : null;
  payload.leadDays = intOf("leadDays", true);
  payload.batchYield = intOf("batchYield", false);
  // Untouched default stays "no colour chosen" (null) so a plain save does not write one.
  payload.fieldColor = f.fieldColor === DEFAULT_FIELD_COLOR && storedColor === null ? null : f.fieldColor;

  return Object.keys(errors).length > 0 ? { errors } : { payload };
}

function Field({
  label,
  hint,
  error,
  children,
}: Readonly<{ label: string; hint?: string; error?: string; children: ReactNode }>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

export function ProductForm({ product }: Readonly<{ product?: ProductDto }>) {
  const router = useRouter();
  const editing = product !== undefined;
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [images, setImages] = useState<ProductImageDto[]>(product?.images ?? []);
  const [leadTouched, setLeadTouched] = useState(editing);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [overLimit, setOverLimit] = useState<OverLimitDateDto[]>([]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  function chooseMode(mode: CapacityMode) {
    setForm((f) => ({
      ...f,
      capacityMode: mode,
      // New independent products usually need more notice (suggestion only; D41/PAGES).
      leadDays: !leadTouched && mode === "INDEPENDENT" ? "2" : !leadTouched ? "1" : f.leadDays,
    }));
    setSaved(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError(null);
    setSaved(false);
    setOverLimit([]);
    const built = buildPayload(form, product?.fieldColor ?? null);
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const result = editing
      ? await adminApi<{ product: ProductDto; overLimitDates: OverLimitDateDto[] }>(
          `/api/admin/products/${product.id}`,
          { method: "PATCH", body: built.payload },
        )
      : await adminApi<{ product: ProductDto }>("/api/admin/products", {
          method: "POST",
          body: built.payload,
        });

    if (!result.ok) {
      const fields = result.fields;
      if (fields && typeof fields === "object") {
        const next: Errors = {};
        for (const [apiField, message] of Object.entries(fields as Record<string, unknown>)) {
          const key = API_FIELD_TO_FORM[apiField];
          if (key && typeof message === "string") next[key] = t.validationFallback;
        }
        setErrors(next);
      }
      setFormError(result.message);
      setPending(false);
      return;
    }

    if (!editing) {
      router.push("/admin/products");
      return; // keep the button disabled while navigating
    }
    const data = result.data as { product: ProductDto; overLimitDates: OverLimitDateDto[] };
    setForm(initialState(data.product));
    setOverLimit(data.overLimitDates ?? []);
    setSaved(true);
    setPending(false);
  }

  const mode = form.capacityMode;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <AdminCard>
        <div className="flex flex-col gap-4">
          <PhotosField productId={product?.id ?? null} images={images} onChange={setImages} />
          <Field label={t.fieldName} error={errors.name}>
            <input
              className={inputClass}
              name="name"
              maxLength={30}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <ColorField value={form.fieldColor} name={form.name} onChange={(hex) => set("fieldColor", hex)} />
          <Field label={t.fieldDescription} error={errors.description}>
            <textarea
              className={inputClass}
              name="description"
              rows={3}
              maxLength={200}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard>
        <div className="flex flex-col gap-4">
          <Field label={t.fieldUnitPrice} hint={t.moneyHint} error={errors.unitPrice}>
            <input
              className={inputClass}
              name="unitPrice"
              inputMode="decimal"
              autoComplete="off"
              value={form.unitPrice}
              onChange={(e) => set("unitPrice", e.target.value)}
            />
          </Field>
          <Field label={t.fieldBundleSize} error={errors.bundleSize}>
            <input
              className={inputClass}
              name="bundleSize"
              inputMode="numeric"
              value={form.bundleSize}
              onChange={(e) => set("bundleSize", e.target.value)}
            />
          </Field>
          <Field label={t.fieldBundlePrice} hint={t.moneyHint} error={errors.bundlePrice}>
            <input
              className={inputClass}
              name="bundlePrice"
              inputMode="decimal"
              autoComplete="off"
              value={form.bundlePrice}
              onChange={(e) => set("bundlePrice", e.target.value)}
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard title={t.fieldMode}>
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label={t.fieldMode} className="flex flex-col gap-2">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  mode === m.value ? "border-accent bg-soft" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="capacityMode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => chooseMode(m.value)}
                  className="mt-1 h-5 w-5 shrink-0"
                />
                <span>
                  <span className="block text-base font-medium">{m.label}</span>
                  <span className="block text-sm text-muted">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {mode === "DOUGH_PER_UNIT" && (
            <Field label={t.fieldDoughG} error={errors.doughG}>
              <input
                className={inputClass}
                name="doughG"
                inputMode="numeric"
                value={form.doughG}
                onChange={(e) => set("doughG", e.target.value)}
              />
            </Field>
          )}
          {mode === "DOUGH_PER_ROUND" && (
            <>
              <Field label={t.fieldRoundG} error={errors.roundG}>
                <input
                  className={inputClass}
                  name="roundG"
                  inputMode="numeric"
                  value={form.roundG}
                  onChange={(e) => set("roundG", e.target.value)}
                />
              </Field>
              <Field label={t.fieldPiecesPerRound} error={errors.piecesPerRound}>
                <input
                  className={inputClass}
                  name="piecesPerRound"
                  inputMode="numeric"
                  value={form.piecesPerRound}
                  onChange={(e) => set("piecesPerRound", e.target.value)}
                />
              </Field>
            </>
          )}
          {mode === "INDEPENDENT" && (
            <Field label={t.fieldDailyLimit} error={errors.dailyLimit}>
              <input
                className={inputClass}
                name="dailyLimit"
                inputMode="numeric"
                value={form.dailyLimit}
                onChange={(e) => set("dailyLimit", e.target.value)}
              />
            </Field>
          )}
        </div>
      </AdminCard>

      <AdminCard>
        <div className="flex flex-col gap-4">
          <Field
            label={t.fieldLeadDays}
            hint={Number(form.leadDays) >= 1 ? fill(t.leadDaysPreview, { n: form.leadDays }) : t.leadDaysPreviewNone}
            error={errors.leadDays}
          >
            <select
              className={inputClass}
              name="leadDays"
              value={form.leadDays}
              onChange={(e) => {
                setLeadTouched(true);
                set("leadDays", e.target.value);
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={String(n)}>
                  {fill(t.leadDaysDay, { n })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.fieldBatchYield} hint={t.batchYieldHint} error={errors.batchYield}>
            <input
              className={inputClass}
              name="batchYield"
              inputMode="numeric"
              value={form.batchYield}
              onChange={(e) => set("batchYield", e.target.value)}
            />
          </Field>
          <Field label={t.fieldStatus} error={errors.status}>
            <select
              className={inputClass}
              name="status"
              value={form.status}
              onChange={(e) => set("status", e.target.value as ProductStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </AdminCard>

      {formError && (
        <p role="alert" className="text-base text-danger">
          {formError}
        </p>
      )}
      {saved && (
        <p role="status" className="text-base font-medium">
          {t.saved}
        </p>
      )}
      {overLimit.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger p-3 text-base text-danger">
          <p>
            {fill(t.overLimitTitle, {
              dates: overLimit.map((d) => shortDate(d.date)).join(t.overLimitSeparator),
            })}
          </p>
          <Link href="/admin/calendar" className="mt-1 inline-flex min-h-11 items-center underline">
            {t.overLimitLink}
          </Link>
        </div>
      )}

      <button type="submit" disabled={pending} className={primaryButton}>
        {editing ? (pending ? t.saving : t.save) : pending ? t.creating : t.create}
      </button>
      <Link href="/admin/products" className="flex min-h-11 items-center justify-center text-base text-muted">
        {t.backToList}
      </Link>
    </form>
  );
}
