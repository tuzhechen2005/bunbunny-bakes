"use client";

import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { LiveBadge } from "./LiveBadge";
import { GameIcon } from "./GameIcon";
import { useGameHub } from "./useGameHub";
import { useEffect, useState } from "react";
import { readRemembered } from "./gameApi";
import { fetchShop } from "./shopApi";
import "./clay.css";

const t = copy.customer.gameHub;
const g = copy.customer.game;

const ART: Record<string, string> = { BIG: "big", TU: "tu", M3: "m3", GRAB: "grab", RUN: "run", TD: "td" };
/** The clay card art; falls back to the flat icon until the art ships. */
function HubArt({ kind }: { kind: string }) {
  const key = ART[kind];
  return <span className="hub-card-art">
    {/* eslint-disable-next-line @next/next/no-img-element -- static clay card art */}
    {key ? <img src={`/brand/art/card-${key}.webp`} alt="" draggable={false} onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} /> : null}
    <span hidden={!!key}><GameIcon kind={kind as never} /></span>
  </span>;
}

/** Top-right 小卖部 entry with the player's 面包币 (only once they've played with a wechat id). */
function HubShopEntry() {
  const [coins, setCoins] = useState<number | null>(null);
  useEffect(() => {
    const id = readRemembered().wechatId;
    if (!id) return;
    let alive = true;
    void fetchShop(id).then(s => { if (alive) setCoins(s.balance); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return <Link href="/game/shop" className={`hub-shop ${focusRing}`} data-testid="hub-shop"><i aria-hidden="true" />{copy.customer.shop.entry}{coins !== null ? <b>{coins}</b> : null}</Link>;
}

export function GameHubPage() {
  const { data, error, reload } = useGameHub(true, { refresh: true });
  // Links stay usable while scores load, or when the connection fails.
  const games = data?.games ?? GAME_CATALOG.map((game) => ({ ...game, weekBest: null, live: false }));
  // Owner 11/02: two big entries (this week's prize game + one easy game), the rest under 更多游戏.
  const prize = data ? games.find((game) => game.kind === data.prizeGame) : undefined;
  const easy = games.find((game) => game.kind === (prize?.kind === "BIG" ? "M3" : "BIG"));
  const featured = [...(prize ? [{ game: prize, label: t.prizeBadge }] : []), ...(easy ? [{ game: easy, label: t.easy }] : [])];
  const rest = games.filter((game) => !featured.some((f) => f.game.kind === game.kind));
  return (
    <div className="game-skin flex flex-1 flex-col text-c-ink">
      <div className="game-skin-inner mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        <TopBar backHref="/" backLabel={g.backLabel} title={t.title} titleAs="h1" right={<HubShopEntry />} />
        <main className="px-5 pt-1 pb-[calc(24px+env(safe-area-inset-bottom))]" data-testid="game-hub">
          {/* eslint-disable-next-line @next/next/no-img-element -- static clay key art */}
          <img className="hub-hero" src="/brand/art/hub-hero.webp" alt="" draggable={false} onError={e => { e.currentTarget.style.display = "none"; }} />
          {featured.length ? <div className="mb-5 grid gap-3" data-testid="hub-featured">
            {featured.map(({ game, label }) => (
              <Link key={game.kind} href={game.href} className={`hub-card hub-card-wide clay-panel relative flex min-w-0 items-center gap-4 px-4 py-3 ${focusRing}`} data-testid={`hub-game-${game.kind.toLowerCase()}`}>
                <HubArt kind={game.kind} />
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-c-grey" data-testid={data?.prizeGame === game.kind ? "hub-prize" : undefined}>{label}</span>
                  <h2 className="m-0 text-[20px] leading-snug font-bold tracking-[-0.03em]">{game.name}</h2>
                  <p className="m-0 mt-1 text-xs text-c-grey" data-testid="hub-best">
                    {data ? game.weekBest === null ? t.emptyBest : <>{g.entryBest} <b className="font-num text-base text-c-ink">{game.weekBest}</b></> : null}
                  </p>
                  {data?.liveScores && game.live ? <LiveBadge /> : null}
                </div>
              </Link>
            ))}
          </div> : null}
          {featured.length ? <h2 className="m-0 mb-2 text-sm font-bold text-c-grey">{t.more}</h2> : null}
          <div className="grid grid-cols-2 gap-3">
            {rest.map((game) => (
              <Link key={game.kind} href={game.href} className={`hub-card clay-panel relative flex min-w-0 px-4 flex-col items-start pt-2 pb-3 ${focusRing}`} data-testid={`hub-game-${game.kind.toLowerCase()}`}>
                <HubArt kind={game.kind} />
                <div className="mt-2">
                  {data?.prizeGame === game.kind ? (
                    <span className="absolute top-3 left-4 text-[11px] font-bold text-c-grey" data-testid="hub-prize">{t.prizeBadge}</span>
                  ) : null}
                  <h2 className="m-0 text-[18px] leading-snug font-bold tracking-[-0.03em]">{game.name}</h2>
                  <p className="m-0 mt-2 min-h-6 text-xs text-c-grey" data-testid="hub-best">
                    {data ? game.weekBest === null ? t.emptyBest : <>{g.entryBest} <b className="font-num text-base text-c-ink">{game.weekBest}</b></> : null}
                  </p>
                  {data?.liveScores && game.live ? <LiveBadge /> : null}
                </div>
              </Link>
            ))}
          </div>
          {error ? (
            <div role="alert" className="mt-5 text-center text-sm text-c-grey">
              <p>{t.loadFailed}</p>
              <button type="button" onClick={reload} className={`mt-2 min-h-11 rounded-full bg-c-wash px-6 font-bold text-c-ink ${focusRing}`}>{g.retry}</button>
            </div>
          ) : !data ? <p role="status" className="mt-5 text-center text-sm text-c-grey">{t.loading}</p> : null}
        </main>
      </div>
    </div>
  );
}
