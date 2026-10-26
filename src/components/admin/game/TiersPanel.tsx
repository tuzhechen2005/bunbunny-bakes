"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { dangerBtn, inputClass, primaryBtn, secondaryBtn } from "@/components/admin/orders/shared";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { TierCircle } from "./TierCircle";
import { TierImageEditor } from "./TierImageEditor";

const t = copy.admin.game;

interface Tier {
  id: string;
  productId: string | null;
  productName: string | null;
  isBig: boolean;
  imageUrl: string | null;
  productImageUrl: string | null;
  color: { bg: string; ink: string };
}
interface Product {
  id: string;
  name: string;
  imageUrl: string | null;
}
interface View {
  configured: boolean;
  tiers: Tier[];
  products: Product[];
}

const MAX_TIERS = 5;

export function TiersPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [addId, setAddId] = useState("");

  const load = useCallback(async () => {
    const r = await adminApi<View>("/api/admin/game/tiers");
    if (r.ok) {
      setView(r.data);
      setError("");
    } else setError(r.message || t.loadFailed);
  }, []);
  useEffect(() => {
    // Initial fetch: the state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    const r = await adminApi<View>(path, { method, body });
    setBusy(false);
    if (r.ok) setView(r.data);
    else if (r.error !== "UNAUTHORIZED") setError(r.message);
    return r.ok;
  }

  if (!view) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}{" "}
        <button type="button" className="min-h-11 underline" onClick={() => void load()}>
          {t.retry}
        </button>
      </p>
    ) : (
      <p className="text-muted">{t.loading}</p>
    );
  }

  const productTiers = view.tiers.filter((x) => !x.isBig);
  const big = view.tiers.find((x) => x.isBig)!;
  const used = new Set(productTiers.map((x) => x.productId));
  const options = view.products.filter((p) => !used.has(p.id));

  function move(index: number, delta: -1 | 1) {
    const ids = productTiers.map((x) => x.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    void call("/api/admin/game/tiers/order", "PUT", { ids });
  }

  function renderImageControls(tier: Tier, name: string) {
    return editing === tier.id ? (
      <TierImageEditor
        tierId={tier.id}
        bg={tier.color.bg}
        name={name}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    ) : (
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setEditing(tier.id)} data-testid={`tier-image-edit-${tier.id}`}>
          {tier.imageUrl ? t.imageReplace : t.imageChoose}
        </button>
        {tier.imageUrl ? (
          <button
            type="button"
            className={dangerBtn}
            disabled={busy}
            onClick={() => void call(`/api/admin/game/tiers/${tier.id}/image`, "DELETE")}
            data-testid={`tier-image-delete-${tier.id}`}
          >
            {t.imageDelete}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="tiers-panel">
      <p className="text-sm text-muted">{t.tiersIntro}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger" data-testid="tiers-error">
          {error}
        </p>
      ) : null}
      {!view.configured ? (
        <AdminCard>
          <p className="mb-3 text-sm text-muted">{t.tiersDefault}</p>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void call("/api/admin/game/tiers", "POST", {})} data-testid="tiers-init">
            {t.startCustom}
          </button>
        </AdminCard>
      ) : null}

      <ol className="flex flex-col gap-3">
        {productTiers.map((tier, i) => {
          const name = tier.productName ?? "";
          return (
            <li key={tier.id} data-testid={`tier-${i}`}>
              <AdminCard>
                <div className="flex items-center gap-3">
                  <TierCircle bg={tier.color.bg} src={tier.imageUrl ?? tier.productImageUrl} alt={fill(t.imageAlt, { name })} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-muted">{fill(t.tierN, { n: i + 1 })}</div>
                    {view.configured ? (
                      <select
                        aria-label={t.productLabel}
                        className={inputClass}
                        value={tier.productId ?? ""}
                        disabled={busy}
                        onChange={(e) => void call(`/api/admin/game/tiers/${tier.id}`, "PATCH", { productId: e.target.value })}
                      >
                        {tier.productId && !view.products.some((p) => p.id === tier.productId) ? (
                          <option value={tier.productId}>{name}</option>
                        ) : null}
                        {view.products
                          .filter((p) => p.id === tier.productId || !used.has(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <div className="text-base font-medium">{name}</div>
                    )}
                  </div>
                </div>
                {view.configured ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className={secondaryBtn} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`${t.moveUp} ${name}`}>
                        {t.moveUp}
                      </button>
                      <button
                        type="button"
                        className={secondaryBtn}
                        disabled={busy || i === productTiers.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`${t.moveDown} ${name}`}
                      >
                        {t.moveDown}
                      </button>
                      <button
                        type="button"
                        className={dangerBtn}
                        disabled={busy || productTiers.length <= 2}
                        onClick={() => setConfirmRemove(tier.id)}
                        aria-label={`${t.removeTier} ${name}`}
                        data-testid={`tier-remove-${i}`}
                      >
                        {t.removeTier}
                      </button>
                    </div>
                    {confirmRemove === tier.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-soft p-2" role="alertdialog">
                        <span className="text-sm">{fill(t.removeConfirm, { name })}</span>
                        <button
                          type="button"
                          className={dangerBtn}
                          disabled={busy}
                          onClick={async () => {
                            await call(`/api/admin/game/tiers/${tier.id}`, "DELETE");
                            setConfirmRemove(null);
                          }}
                          data-testid="tier-remove-yes"
                        >
                          {t.removeTier}
                        </button>
                        <button type="button" className={secondaryBtn} onClick={() => setConfirmRemove(null)}>
                          {t.cancel}
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-3">{renderImageControls(tier, name)}</div>
                  </>
                ) : null}
              </AdminCard>
            </li>
          );
        })}
      </ol>

      {view.configured ? (
        <AdminCard>
          {productTiers.length >= MAX_TIERS ? (
            <p className="text-sm text-muted">{t.maxTiers}</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted">{t.noProductLeft}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select aria-label={t.addPick} className={`${inputClass} min-w-0 flex-1`} value={addId} onChange={(e) => setAddId(e.target.value)} data-testid="tier-add-select">
                <option value="">{t.addPick}</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy || !addId}
                onClick={async () => {
                  if (await call("/api/admin/game/tiers", "POST", { productId: addId })) setAddId("");
                }}
                data-testid="tier-add"
              >
                {t.addTier}
              </button>
            </div>
          )}
        </AdminCard>
      ) : null}

      <AdminCard>
        <div className="flex items-center gap-3" data-testid="tier-big">
          <TierCircle bg={big.color.bg} src={big.imageUrl ?? "/brand/logo.webp"} alt={fill(t.imageAlt, { name: t.bigName })} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium">{t.bigName}</div>
            <div className="text-sm text-muted">{big.imageUrl ? t.bigHint : t.imageDefaultBig}</div>
          </div>
        </div>
        <div className="mt-3">{renderImageControls(big, t.bigName)}</div>
      </AdminCard>
    </div>
  );
}
