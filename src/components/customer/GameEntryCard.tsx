"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { focusRing } from "@/components/ui/focus";
import "@/components/game/game.css";

const t = copy.customer.game;

/**
 * Home entry to the two games (D125): one card, two halves split by a diagonal slash. Left 消除大面包
 * (D100) → /game, right 兔了个兔 → /game/tu, each with its own weekly best and one shared prize tag.
 * The bests are fetched lazily, a moment after the card comes near the screen, so they are never part of
 * the first load. Each half beats like a heart (game.css) except under reduced motion. Any failure just
 * keeps the neutral line.
 */
export function GameEntryCard() {
  const ref = useRef<HTMLDivElement>(null);
  const [best, setBest] = useState<number | null>(null);
  const [bestTu, setBestTu] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    let idle: number | undefined;
    const fetchBest = (url: string, set: (n: number) => void) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { top?: { score?: unknown }[] } | null) => {
          const s = d?.top?.[0]?.score;
          if (!cancelled && typeof s === "number" && s > 0) set(s);
        })
        .catch(() => {});
    const load = () => {
      void fetchBest("/api/game/leaderboard", setBest);
      void fetchBest("/api/game/tu/leaderboard", setBestTu);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        idle = window.setTimeout(load, 400);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (idle !== undefined) clearTimeout(idle);
    };
  }, []);

  const half = `game-entry flex min-w-0 flex-col items-center gap-2 rounded-3xl px-2 pt-10 pb-5 text-center text-c-ink ${focusRing}`;
  const line = (n: number | null, id: string) => (
    <span className="block text-sm text-c-grey" data-testid={id}>
      {n !== null ? (
        <>
          {t.entryBest} <b className="font-num text-[17px] text-c-ink">{n}</b>
        </>
      ) : (
        t.entryNeutral
      )}
    </span>
  );

  return (
    <section className="px-5 pt-2 pb-7">
      <div ref={ref} className="relative grid min-h-[84px] grid-cols-2 rounded-3xl bg-c-wash" data-testid="game-entry-card">
        <span
          className="pointer-events-none absolute top-3 left-4 z-10 rounded-full bg-c-paper px-2 py-0.5 text-xs font-bold whitespace-nowrap text-c-ink shadow-[inset_0_0_0_1px_var(--c-line)]"
          data-testid="game-entry-prize"
        >
          {t.entryPrize}
        </span>
        <Link href="/game" aria-label={t.entryLabel} className={half} data-testid="game-entry">
          <span className="game-entry-logo grid size-14 shrink-0 place-items-center rounded-full bg-c-paper shadow-[inset_0_0_0_1.5px_var(--c-line)]">
            <Logo className="h-10 w-auto" />
          </span>
          <b className="font-display text-[22px] leading-[1.15] tracking-[-0.03em]">{t.title}</b>
          {line(best, "game-entry-line")}
        </Link>
        <span aria-hidden="true" className="pointer-events-none absolute top-5 bottom-5 left-1/2 w-[1.5px] -translate-x-1/2 rotate-[14deg] rounded-full bg-c-line" />
        <Link href="/game/tu" aria-label={t.entryTuLabel} className={`${half} game-entry-b`} data-testid="game-entry-tu">
          <span className="game-entry-logo game-entry-b grid size-14 shrink-0 place-items-center">
            <span className="relative block h-14 w-[37px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/bag.webp" alt="" width={440} height={660} className="h-full w-full" draggable={false} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo.webp" alt="" width={772} height={951} className="absolute top-[34%] left-[19%] w-[62%]" draggable={false} />
            </span>
          </span>
          <b className="font-display text-[22px] leading-[1.15] tracking-[-0.03em]">{t.tuTitle}</b>
          {line(bestTu, "game-entry-tu-line")}
        </Link>
      </div>
    </section>
  );
}
