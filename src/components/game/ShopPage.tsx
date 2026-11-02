"use client";
/* eslint-disable @next/next/no-img-element -- static clay art */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TopBar } from "@/components/ui/TopBar";
import { copy } from "@/copy";
import { fill } from "@/components/customer/format";
import { readRemembered, writeRemembered } from "./gameApi";
import { GameShell, GameRegistrationField, gamePrimary } from "./GameChrome";
import { buyItem, fetchShop, type ShopItem, type ShopState } from "./shopApi";

const t = copy.customer.shop;

/** Rolls a number toward its target (coins feel earned). */
function useRolling(target: number) {
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (shown === target) return;
    const step = Math.max(1, Math.ceil(Math.abs(target - shown) / 12));
    const id = setTimeout(() => setShown(v => v < target ? Math.min(target, v + step) : Math.max(target, v - step)), 30);
    return () => clearTimeout(id);
  }, [shown, target]);
  return shown;
}

export function ShopPage() {
  const [wechat, setWechat] = useState("");
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<ShopState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<ShopItem | null>(null);
  const [toast, setToast] = useState("");
  useEffect(() => { const id = setTimeout(() => setWechat(readRemembered().wechatId), 0); return () => clearTimeout(id); }, []);
  const load = useCallback(async (id: string) => {
    setError("");
    try { setState(await fetchShop(id)); } catch { setError(t.loadFailed); }
  }, []);
  useEffect(() => { if (wechat) { const id = setTimeout(() => void load(wechat), 0); return () => clearTimeout(id); } }, [wechat, load]);
  const balance = useRolling(state?.balance ?? 0);
  const buy = async (item: ShopItem) => {
    if (!wechat || busy) return;
    setBusy(item); setToast("");
    try { setState(await buyItem(wechat, item)); setToast(t.bought); }
    catch (e) { setToast((e as { code?: string }).code === "INSUFFICIENT" ? t.notEnough : t.loadFailed); }
    finally { setBusy(null); setTimeout(() => setToast(""), 1600); }
  };
  const enter = (e: FormEvent) => { e.preventDefault(); const id = draft.trim(); if (!id) return; writeRemembered({ wechatId: id }); setWechat(id); };
  return <GameShell>
    <TopBar backHref="/game/hub" backLabel={copy.customer.gameHub.backLabel} title={t.title} titleAs="h1" />
    <main className="shop px-5 pb-[calc(28px+env(safe-area-inset-bottom))]" data-testid="shop">
      <img className="shop-hero" src="/brand/art/shop/shop-hero.webp" alt="" draggable={false} onError={e => { e.currentTarget.style.display = "none"; }} />
      {!wechat ? <form onSubmit={enter} className="clay-panel mt-2 flex flex-col gap-3 p-4" data-testid="shop-who">
        <p className="m-0 text-sm text-c-grey">{t.who}</p>
        <GameRegistrationField kind="wechat" testId="shop-wechat" value={draft} onChange={e => setDraft(e.target.value)} />
        <button className={gamePrimary} data-testid="shop-enter">{t.whoGo}</button>
      </form> : <>
        <div className="shop-wallet clay-panel" data-testid="shop-wallet">
          <img src="/brand/art/shop/coin-stack.webp" alt="" onError={e => { e.currentTarget.src = "/brand/art/icon-coin.webp"; }} />
          <div><span>{t.coins}</span><b className="font-num" data-testid="shop-balance">{balance}</b></div>
        </div>
        {error ? <p role="alert" className="mt-3 text-center text-sm text-c-red">{error} <button className="underline" onClick={() => void load(wechat)}>{t.retry}</button></p> : null}
        <div className="shop-grid">
          {(state?.catalog ?? [{ item: "bomb" as ShopItem, price: 60 }, { item: "bell" as ShopItem, price: 100 }, { item: "slide" as ShopItem, price: 80 }]).map(({ item, price }) => {
            const owned = state?.inventory?.[item] ?? 0, poor = !!state && state.balance < price;
            return <div key={item} className="shop-card clay-panel" data-testid={`shop-item-${item}`}>
              <img src={`/brand/art/shop/item-${item}.webp`} alt="" draggable={false} />
              <b className="font-display">{t.items[item].name}</b>
              <p>{t.items[item].text}</p>
              <span className="shop-owned">{fill(t.owned, { n: String(owned) })}</span>
              <button className="clay-btn font-display shop-buy" disabled={!state || poor || busy !== null} onClick={() => void buy(item)} data-testid={`shop-buy-${item}`}>
                <i aria-hidden="true" /><span className="font-num">{price}</span>
              </button>
            </div>;
          })}
        </div>
        <p className="shop-rule">{t.perLevel}</p>
        <div className="shop-how">
          <b className="font-display">{t.howTitle}</b>
          <ul>{t.how.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      </>}
      {toast ? <p className="shop-toast font-display" role="status">{toast}</p> : null}
    </main>
  </GameShell>;
}
