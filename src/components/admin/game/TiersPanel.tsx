"use client";

import { useCallback, useEffect, useState } from "react";
import { ColorField } from "@/components/admin/products/ColorField";
import { AdminCard } from "@/components/admin/AdminCard";
import { dangerBtn, inputClass, primaryBtn, secondaryBtn } from "@/components/admin/orders/shared";
import { fill } from "@/components/customer/format";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { TierCircle } from "./TierCircle";
import { TierImageEditor } from "./TierImageEditor";
import { DEFAULT_FIELD_COLOR } from "@/lib/fieldColor";

const t = copy.admin.game;

interface Tier {
  id: string;
  productId: string | null;
  productName: string | null;
  isBig: boolean;
  gameOnly: boolean;
  name: string;
  fieldColor: string | null;
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

const MAX_TIERS = 8;

/** Name + colour fields shared by "add a game piece" and "edit a tier's look". */
function LookForm({
  initialName,
  initialColor,
  submitLabel,
  busy,
  testId,
  onSubmit,
  onCancel,
  onResetColor,
}: Readonly<{
  initialName: string;
  initialColor: string;
  submitLabel: string;
  busy: boolean;
  testId: string;
  onSubmit: (v: { name: string; fieldColor: string }) => void;
  onCancel?: () => void;
  onResetColor?: () => void;
}>) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t.pieceName}
        <input
          className={inputClass}
          value={name}
          maxLength={12}
          placeholder={t.pieceNameHint}
          onChange={(e) => setName(e.target.value)}
          data-testid={`${testId}-name`}
        />
      </label>
      <ColorField value={color} name={name} label={t.pieceColor} onChange={setColor} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !name.trim()}
          onClick={() => onSubmit({ name: name.trim(), fieldColor: color })}
          data-testid={`${testId}-submit`}
        >
          {submitLabel}
        </button>
        {onResetColor ? (
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onResetColor}>
            {t.resetColor}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className={secondaryBtn} onClick={onCancel}>
            {t.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TiersPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const [addingPiece, setAddingPiece] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);

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
          const name = tier.name;
          return (
            <li key={tier.id} data-testid={`tier-${i}`}>
              <AdminCard>
                <div className="flex items-center gap-3">
                  <TierCircle bg={tier.color.bg} ink={tier.color.ink} initial={name} src={tier.imageUrl ?? tier.productImageUrl} alt={fill(t.imageAlt, { name })} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      {fill(t.tierN, { n: i + 1 })}
                      {tier.gameOnly ? (
                        <span className="rounded-full bg-soft px-2 py-0.5 text-xs" data-testid={`tier-gameonly-${i}`}>
                          {t.gameOnlyTag}
                        </span>
                      ) : null}
                    </div>
                    {tier.gameOnly ? (
                      <div className="text-base font-medium" data-testid={`tier-name-${i}`}>
                        {name || <span className="text-danger">{t.needsName}</span>}
                      </div>
                    ) : view.configured ? (
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
                    <div className="mt-3">
                      {looking === tier.id ? (
                        <LookForm
                          testId={`tier-look-${i}`}
                          initialName={name}
                          initialColor={tier.color.bg}
                          submitLabel={t.saveLook}
                          busy={busy}
                          onCancel={() => setLooking(null)}
                          onResetColor={
                            tier.gameOnly || !tier.fieldColor
                              ? undefined
                              : async () => {
                                  if (await call(`/api/admin/game/tiers/${tier.id}`, "PATCH", { fieldColor: null })) setLooking(null);
                                }
                          }
                          onSubmit={async (v) => {
                            if (await call(`/api/admin/game/tiers/${tier.id}`, "PATCH", v)) setLooking(null);
                          }}
                        />
                      ) : (
                        <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setLooking(tier.id)} data-testid={`tier-look-edit-${i}`}>
                          {t.editLook}
                        </button>
                      )}
                    </div>
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
          ) : (
            <div className="flex flex-col gap-3">
              {options.length === 0 ? (
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
              {addingPiece ? (
                <LookForm
                  testId="piece-form"
                  initialName=""
                  initialColor={DEFAULT_FIELD_COLOR}
                  submitLabel={t.pieceAdd}
                  busy={busy}
                  onCancel={() => setAddingPiece(false)}
                  onSubmit={async (v) => {
                    if (await call("/api/admin/game/tiers", "POST", v)) setAddingPiece(false);
                  }}
                />
              ) : (
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setAddingPiece(true)} data-testid="piece-add">
                  {t.addPiece}
                </button>
              )}
            </div>
          )}
        </AdminCard>
      ) : null}

      <AdminCard>
        <div className="flex items-center gap-3" data-testid="tier-big">
          <TierCircle bg={big.color.bg} ink={big.color.ink} src={big.imageUrl ?? "/brand/logo.webp"} alt={fill(t.imageAlt, { name: t.bigName })} />
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
