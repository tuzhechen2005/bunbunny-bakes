"use client";

import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { GameIcon } from "./GameIcon";
import { useGameHub } from "./useGameHub";

const t = copy.customer.gameHub;
const g = copy.customer.game;

export function GameHubPage() {
  const { data, error, reload } = useGameHub();
  // Links stay usable while scores load, or when the connection fails.
  const games = data?.games ?? GAME_CATALOG.map((game) => ({ ...game, weekBest: null }));
  return (
    <div className="flex flex-1 flex-col bg-c-wash text-c-ink">
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col bg-c-paper">
        <TopBar backHref="/" backLabel={g.backLabel} title={t.title} titleAs="h1" />
        <main className="px-5 pt-5 pb-[calc(24px+env(safe-area-inset-bottom))]" data-testid="game-hub">
          <div className="grid grid-cols-2 gap-3">
            {games.map((game) => (
              <Link key={game.kind} href={game.href} className={`relative flex min-w-0 flex-col items-start rounded-3xl bg-c-wash px-4 pt-11 pb-5 ${focusRing}`} data-testid={`hub-game-${game.kind.toLowerCase()}`}>
                {data?.prizeGame === game.kind ? (
                  <span className="absolute top-3 left-4 text-[11px] font-bold text-c-grey" data-testid="hub-prize">{t.prizeBadge}</span>
                ) : null}
                <GameIcon kind={game.kind} />
                <h2 className="m-0 mt-5 text-[20px] leading-snug font-bold tracking-[-0.03em]">{game.name}</h2>
                <p className="m-0 mt-2 min-h-6 text-xs text-c-grey" data-testid="hub-best">
                  {data ? game.weekBest === null ? t.emptyBest : <>{g.entryBest} <b className="font-num text-base text-c-ink">{game.weekBest}</b></> : null}
                </p>
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
