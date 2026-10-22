"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import {
  centsToDollars,
  codePointLength,
  dollarsToCents,
  isAllowedCutoffTime,
  parseIntStrict,
} from "./convert";
import { PasswordSection } from "./PasswordSection";

const t = copy.admin.settings;

/** The API shape (GET response without orderingEnabled/updatedAt = PUT body). */
interface SettingsPayload {
  cutoffTime: string;
  defaultDoughLimitG: number;
  defaultDeliveryLimit: number;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number;
  maxQtyPerItem: number;
  ownerWechatId: string;
  showWechatOnHome: boolean;
  pickupNote: string;
  bakingTextBread: string;
  bakingTextOther: string;
}
type SettingsView = SettingsPayload & { orderingEnabled: boolean; updatedAt: string };

/** What the inputs hold (strings, dollars for money). */
interface Draft {
  cutoffTime: string;
  defaultDoughLimitG: string;
  defaultDeliveryLimit: string;
  deliveryFeeCents: string;
  freeDeliveryMinCents: string;
  maxQtyPerItem: string;
  ownerWechatId: string;
  showWechatOnHome: boolean;
  pickupNote: string;
  bakingTextBread: string;
  bakingTextOther: string;
}
type Field = keyof Draft;

type SectionId = "rules" | "limits" | "fees" | "contact" | "texts";
const SECTION_FIELDS: Record<SectionId, Field[]> = {
  rules: ["cutoffTime", "maxQtyPerItem"],
  limits: ["defaultDoughLimitG", "defaultDeliveryLimit"],
  fees: ["deliveryFeeCents", "freeDeliveryMinCents"],
  contact: ["ownerWechatId", "showWechatOnHome"],
  texts: ["pickupNote", "bakingTextBread", "bakingTextOther"],
};

function toDraft(s: SettingsPayload): Draft {
  return {
    cutoffTime: s.cutoffTime,
    defaultDoughLimitG: String(s.defaultDoughLimitG),
    defaultDeliveryLimit: String(s.defaultDeliveryLimit),
    deliveryFeeCents: centsToDollars(s.deliveryFeeCents),
    freeDeliveryMinCents: centsToDollars(s.freeDeliveryMinCents),
    maxQtyPerItem: String(s.maxQtyPerItem),
    ownerWechatId: s.ownerWechatId,
    showWechatOnHome: s.showWechatOnHome,
    pickupNote: s.pickupNote,
    bakingTextBread: s.bakingTextBread,
    bakingTextOther: s.bakingTextOther,
  };
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/**
 * Parses the fields of one section onto the saved values: other sections keep the saved
 * (not the half-edited) values, so a section's save never saves another section's edits.
 */
function buildPayload(
  section: SectionId,
  saved: SettingsPayload,
  d: Draft,
): { payload: SettingsPayload } | { errors: Partial<Record<Field, string>> } {
  const payload: SettingsPayload = { ...saved };
  const errors: Partial<Record<Field, string>> = {};
  const intField = (f: "defaultDoughLimitG" | "defaultDeliveryLimit") => {
    const n = parseIntStrict(d[f]);
    if (n === null) errors[f] = t.intInvalid;
    else payload[f] = n;
  };
  const moneyField = (f: "deliveryFeeCents" | "freeDeliveryMinCents") => {
    const n = dollarsToCents(d[f]);
    if (n === null) errors[f] = t.moneyInvalid;
    else payload[f] = n;
  };
  const textField = (f: "ownerWechatId" | "pickupNote" | "bakingTextBread" | "bakingTextOther", min: number, max: number) => {
    const v = d[f].trim();
    if (codePointLength(v) < min) errors[f] = t.required;
    else if (codePointLength(v) > max) errors[f] = fill(t.tooLong, { max });
    else payload[f] = v;
  };

  switch (section) {
    case "rules": {
      if (!isAllowedCutoffTime(d.cutoffTime)) errors.cutoffTime = t.cutoffTimeInvalid;
      else payload.cutoffTime = d.cutoffTime;
      const q = parseIntStrict(d.maxQtyPerItem);
      if (q === null || q < 1 || q > 99) errors.maxQtyPerItem = t.maxQtyInvalid;
      else payload.maxQtyPerItem = q;
      break;
    }
    case "limits":
      intField("defaultDoughLimitG");
      intField("defaultDeliveryLimit");
      break;
    case "fees":
      moneyField("deliveryFeeCents");
      moneyField("freeDeliveryMinCents");
      break;
    case "contact":
      textField("ownerWechatId", 0, 40);
      payload.showWechatOnHome = d.showWechatOnHome;
      break;
    case "texts":
      textField("pickupNote", 0, 100);
      textField("bakingTextBread", 1, 40);
      textField("bakingTextOther", 1, 40);
      break;
  }
  return Object.keys(errors).length ? { errors } : { payload };
}

const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-background px-3 py-2 text-base text-foreground focus:border-accent focus:outline-none";
const saveClass =
  "min-h-11 w-full rounded-lg bg-accent px-4 text-base font-medium text-accent-ink disabled:bg-disabled disabled:text-disabled-ink";

function FieldRow({
  label,
  hint,
  error,
  children,
}: Readonly<{ label: string; hint?: string; error?: string; children: ReactNode }>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-sm text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

export function SettingsPage() {
  const [saved, setSaved] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, setPending] = useState<SectionId | null>(null);
  const [notice, setNotice] = useState<{ section: SectionId; ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await adminApi<SettingsView>("/api/admin/settings");
    if (result.ok) {
      setSaved(result.data);
      setDraft(toDraft(result.data));
    } else if (result.error !== "UNAUTHORIZED") {
      setLoadError(result.message || t.loadFailed);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client-side data load
    void load();
  }, [load]);

  function set<K extends Field>(field: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [field]: value } : d));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function onSave(section: SectionId) {
    if (!saved || !draft || pending) return;
    setNotice(null);
    const built = buildPayload(section, saved, draft);
    if ("errors" in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setPending(section);
    const result = await adminApi<SettingsView>("/api/admin/settings", { method: "PUT", body: built.payload });
    setPending(null);
    if (result.ok) {
      setSaved(result.data);
      const fresh = toDraft(result.data);
      setDraft((d) => {
        if (!d) return fresh;
        const next = { ...d };
        for (const f of SECTION_FIELDS[section]) (next as Record<Field, unknown>)[f] = fresh[f];
        return next;
      });
      setNotice({ section, ok: true, text: t.saved });
      return;
    }
    const serverFields = (result as { fields?: Record<string, string> }).fields;
    if (serverFields) {
      const mapped: Partial<Record<Field, string>> = {};
      for (const f of SECTION_FIELDS[section]) if (serverFields[f]) mapped[f] = serverFields[f];
      setErrors(mapped);
    }
    setNotice({ section, ok: false, text: result.message });
  }

  const renderSave = (section: SectionId) => {
    const busy = pending === section;
    return (
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className={saveClass}
          disabled={pending !== null}
          onClick={() => void onSave(section)}
        >
          {busy ? t.saving : t.save}
        </button>
        {notice?.section === section && (
          <p role={notice.ok ? "status" : "alert"} className={`text-sm ${notice.ok ? "text-muted" : "text-danger"}`}>
            {notice.text}
          </p>
        )}
      </div>
    );
  };

  if (loadError) {
    return (
      <>
        <PageHeader title={t.title} />
        <AdminCard>
          <p role="alert" className="mb-3 text-danger">
            {loadError}
          </p>
          <button type="button" className={saveClass} onClick={() => void load()}>
            {t.retry}
          </button>
        </AdminCard>
      </>
    );
  }
  if (!saved || !draft) {
    return (
      <>
        <PageHeader title={t.title} />
        <p className="text-muted">{t.loading}</p>
      </>
    );
  }

  const updatedText = new Date(saved.updatedAt).toLocaleString("zh-CN", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <>
      <PageHeader title={t.title} />
      <div className="flex flex-col gap-4">
        <AdminCard title={t.rules.title}>
          <div className="flex flex-col gap-4">
            <FieldRow label={t.rules.cutoffTime} hint={t.rules.cutoffHint} error={errors.cutoffTime}>
              <input
                type="time"
                name="cutoffTime"
                className={inputClass}
                value={draft.cutoffTime}
                onChange={(e) => set("cutoffTime", e.target.value)}
              />
            </FieldRow>
            <FieldRow label={t.rules.maxQty} hint={t.rules.maxQtyHint} error={errors.maxQtyPerItem}>
              <input
                name="maxQtyPerItem"
                inputMode="numeric"
                className={inputClass}
                value={draft.maxQtyPerItem}
                onChange={(e) => set("maxQtyPerItem", e.target.value)}
              />
            </FieldRow>
          </div>
          {renderSave("rules")}
        </AdminCard>

        <AdminCard title={t.limits.title}>
          <div className="flex flex-col gap-4">
            <FieldRow label={t.limits.dough} hint={t.limits.doughHint} error={errors.defaultDoughLimitG}>
              <input
                name="defaultDoughLimitG"
                inputMode="numeric"
                className={inputClass}
                value={draft.defaultDoughLimitG}
                onChange={(e) => set("defaultDoughLimitG", e.target.value)}
              />
            </FieldRow>
            <FieldRow label={t.limits.delivery} hint={t.limits.deliveryHint} error={errors.defaultDeliveryLimit}>
              <input
                name="defaultDeliveryLimit"
                inputMode="numeric"
                className={inputClass}
                value={draft.defaultDeliveryLimit}
                onChange={(e) => set("defaultDeliveryLimit", e.target.value)}
              />
            </FieldRow>
          </div>
          {renderSave("limits")}
        </AdminCard>

        <AdminCard title={t.fees.title}>
          <div className="flex flex-col gap-4">
            <FieldRow label={t.fees.fee} error={errors.deliveryFeeCents}>
              <input
                name="deliveryFee"
                inputMode="decimal"
                className={inputClass}
                value={draft.deliveryFeeCents}
                onChange={(e) => set("deliveryFeeCents", e.target.value)}
              />
            </FieldRow>
            <FieldRow label={t.fees.freeMin} hint={t.fees.freeMinHint} error={errors.freeDeliveryMinCents}>
              <input
                name="freeDeliveryMin"
                inputMode="decimal"
                className={inputClass}
                value={draft.freeDeliveryMinCents}
                onChange={(e) => set("freeDeliveryMinCents", e.target.value)}
              />
            </FieldRow>
          </div>
          {renderSave("fees")}
        </AdminCard>

        <AdminCard title={t.contact.title}>
          <div className="flex flex-col gap-4">
            <FieldRow label={t.contact.wechat} hint={t.contact.wechatHint} error={errors.ownerWechatId}>
              <input
                name="ownerWechatId"
                autoCapitalize="none"
                autoCorrect="off"
                className={inputClass}
                value={draft.ownerWechatId}
                onChange={(e) => set("ownerWechatId", e.target.value)}
              />
            </FieldRow>
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                name="showWechatOnHome"
                className="mt-1 h-6 w-6 shrink-0 accent-accent"
                checked={draft.showWechatOnHome}
                onChange={(e) => set("showWechatOnHome", e.target.checked)}
              />
              <span className="flex flex-col">
                <span className="text-base font-medium">{t.contact.showOnHome}</span>
                <span className="text-sm text-muted">{t.contact.showOnHomeHint}</span>
              </span>
            </label>
          </div>
          {renderSave("contact")}
        </AdminCard>

        <AdminCard title={t.texts.title}>
          <div className="flex flex-col gap-4">
            <FieldRow label={t.texts.pickupNote} error={errors.pickupNote}>
              <textarea
                name="pickupNote"
                rows={3}
                className={inputClass}
                value={draft.pickupNote}
                onChange={(e) => set("pickupNote", e.target.value)}
              />
            </FieldRow>
            <FieldRow label={t.texts.bakingBread} error={errors.bakingTextBread}>
              <input
                name="bakingTextBread"
                className={inputClass}
                value={draft.bakingTextBread}
                onChange={(e) => set("bakingTextBread", e.target.value)}
              />
            </FieldRow>
            <FieldRow label={t.texts.bakingOther} error={errors.bakingTextOther}>
              <input
                name="bakingTextOther"
                className={inputClass}
                value={draft.bakingTextOther}
                onChange={(e) => set("bakingTextOther", e.target.value)}
              />
            </FieldRow>
          </div>
          {renderSave("texts")}
        </AdminCard>

        <p className="text-sm text-muted">{fill(t.lastUpdated, { time: updatedText })}</p>

        <PasswordSection />
      </div>
    </>
  );
}
