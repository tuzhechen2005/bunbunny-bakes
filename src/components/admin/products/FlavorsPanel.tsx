"use client";

import { useState } from "react";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { formatCents } from "@/domain/pricing";
import type { FlavorDto, ProductDto } from "./describe";
import { centsToDollarInput, parseDollarsToCents } from "./money";

const t = copy.admin.products.flavors;
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const sorted = (fs: FlavorDto[] = []) => [...fs].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));

/** F1: the product's flavours — add, rename, reprice, reorder, take off / put back on sale. Never deletes. */
export function FlavorsPanel({ product }: Readonly<{ product: ProductDto }>) {
  const [flavors, setFlavors] = useState<FlavorDto[]>(() => sorted(product.flavors));
  type Form = { name: string; price: string; limit: string; bundle: string };
  const blank: Form = { name: "", price: "", limit: "", bundle: "" };
  const [draft, setDraft] = useState<Form>(blank);
  const [editing, setEditing] = useState<Record<string, Form>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (path: string, method: "POST" | "PATCH" | "PUT", body: unknown) => {
    setBusy(true); setError(null);
    const r = await adminApi<{ product: ProductDto }>(path, { method, body });
    setBusy(false);
    if (r.ok && r.data.product) { setFlavors(sorted(r.data.product.flavors)); return true; }
    setError(r.ok ? t.failed : r.message);
    return false;
  };
  const base = `/api/admin/products/${product.id}/flavors`;
  // F2: blank limit / bundle = null (no daily limit / no bundle price).
  const parse = (f: Form) => {
    const n = f.name.trim(), c = parseDollarsToCents(f.price);
    const l = f.limit.trim(), b = f.bundle.trim();
    const bc = b === "" ? null : parseDollarsToCents(b);
    const dailyLimit = l === "" ? null : /^\d{1,7}$/.test(l) && Number(l) <= 1_000_000 ? Number(l) : undefined;
    if (!n || [...n].length > 12 || !c.ok || dailyLimit === undefined || (bc && (!bc.ok || bc.cents < 1))) return null;
    return { name: n, priceCents: c.cents, dailyLimit, bundlePriceCents: bc && bc.ok ? bc.cents : null };
  };
  const add = async () => {
    const v = parse(draft);
    if (!v) { setError(t.invalid); return; }
    if (await run(base, "POST", v)) setDraft(blank);
  };
  const save = async (f: FlavorDto) => {
    const e = editing[f.id]; if (!e) return;
    const v = parse(e);
    if (!v) { setError(t.invalid); return; }
    if (await run(`${base}/${f.id}`, "PATCH", v)) setEditing((all) => { const next = { ...all }; delete next[f.id]; return next; });
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = flavors.map((f) => f.id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(`${base}/order`, "PUT", { ids });
  };

  const extras = (form: Form, set: (next: Form) => void, id: string) => (
    <>
      <label className="flex items-center gap-1 text-xs text-muted">
        {t.dailyLimit}
        <input inputMode="numeric" placeholder={t.dailyLimitPlaceholder} className="h-10 w-20 rounded-lg border border-line bg-card px-2 text-base text-foreground" value={form.limit} onChange={(ev) => set({ ...form, limit: ev.target.value })} data-testid={`flavor-limit-${id}`} />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        {fill(t.bundlePrice, { size: product.bundleSize })}
        <input inputMode="decimal" placeholder={t.bundlePricePlaceholder} className="h-10 w-20 rounded-lg border border-line bg-card px-2 text-base text-foreground" value={form.bundle} onChange={(ev) => set({ ...form, bundle: ev.target.value })} data-testid={`flavor-bundle-${id}`} />
      </label>
    </>
  );

  return (
    <section className="mt-8 rounded-2xl border border-line bg-card p-4" data-testid="flavors-panel">
      <h2 className="m-0 text-lg font-bold">{t.title}</h2>
      <p className="mt-1 text-sm text-muted">{t.hint}</p>
      {flavors.length === 0 ? <p className="mt-3 text-sm text-muted">{t.empty}</p> : (
        <ul className="mt-3 flex flex-col gap-2 p-0">
          {flavors.map((f, i) => {
            const e = editing[f.id];
            return (
              <li key={f.id} className={`flex flex-wrap items-center gap-2 rounded-xl border border-line p-2 ${f.active ? "" : "opacity-60"}`} data-testid="flavor-row">
                {e ? (
                  <>
                    <input aria-label={t.name} className="h-10 w-28 rounded-lg border border-line bg-card px-2" value={e.name} onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, name: ev.target.value } })} />
                    <input aria-label={t.price} inputMode="decimal" className="h-10 w-20 rounded-lg border border-line bg-card px-2" value={e.price} onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, price: ev.target.value } })} />
                    {extras(e, (next) => setEditing({ ...editing, [f.id]: next }), f.id)}
                    <button type="button" disabled={busy} className="h-10 rounded-lg bg-accent px-3 font-bold text-accent-ink" onClick={() => void save(f)}>{t.save}</button>
                  </>
                ) : (
                  <button type="button" className="min-h-10 flex-1 text-left" onClick={() => setEditing({ ...editing, [f.id]: { name: f.name, price: centsToDollarInput(f.priceCents), limit: f.dailyLimit === null ? "" : String(f.dailyLimit), bundle: f.bundlePriceCents === null ? "" : centsToDollarInput(f.bundlePriceCents) } })}>
                    <b>{f.name}</b> <span className="text-muted">{formatCents(f.priceCents)}</span>
                    {f.bundlePriceCents !== null ? <small className="ml-1 text-muted">{fill(copy.customer.home.bundlePrice, { size: product.bundleSize, price: formatCents(f.bundlePriceCents) })}</small> : null}
                    {f.dailyLimit !== null ? <small className="ml-1 text-muted">{fill(t.limitTag, { n: f.dailyLimit })}</small> : null}
                    <small className="ml-1 text-muted">{f.active ? t.onSale : t.offSale}</small>
                  </button>
                )}
                <button type="button" aria-label={t.up} disabled={busy || i === 0} className="size-10 rounded-lg border border-line" onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label={t.down} disabled={busy || i === flavors.length - 1} className="size-10 rounded-lg border border-line" onClick={() => move(i, 1)}>↓</button>
                <button type="button" disabled={busy} className="h-10 rounded-lg border border-line px-3 text-sm" onClick={() => void run(`${base}/${f.id}`, "PATCH", { active: !f.active })}>{f.active ? t.takeOff : t.putOn}</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label={t.name} placeholder={t.name} className="h-10 w-28 rounded-lg border border-line bg-card px-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="flavor-new-name" />
        <input aria-label={t.price} placeholder={t.price} inputMode="decimal" className="h-10 w-20 rounded-lg border border-line bg-card px-2" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} data-testid="flavor-new-price" />
        {extras(draft, setDraft, "new")}
        <button type="button" disabled={busy} className="h-10 rounded-lg bg-accent px-3 font-bold text-accent-ink" onClick={() => void add()} data-testid="flavor-add">{t.add}</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
