"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { focusRing } from "@/components/ui/focus";
import "@/components/game/game.css";

const t = copy.customer.game;

/**
 * Home entry to 消除大面包 (D100): below 「全部面包」. The weekly best is fetched lazily, a moment after the
 * card comes near the screen, so it is never part of the first load. Beats like a heart (scale up to
 * 1.06, game.css) except under reduced motion. Any failure just keeps the neutral line.
 */
export function GameEntryCard() {
  const ref = useRef<HTMLAnchorElement>(null);
  const [best, setBest] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    let idle: number | undefined;
    const load = () => {
      fetch("/api/game/leaderboard", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { top?: { score?: unknown }[] } | null) => {
          const s = d?.top?.[0]?.score;
          if (!cancelled && typeof s === "number" && s > 0) setBest(s);
        })
        .catch(() => {});
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

  return (
    <section className="px-5 pt-2 pb-7">
      <Link
        ref={ref}
        href="/game"
        aria-label={t.entryLabel}
        className={`game-entry flex min-h-[84px] items-center gap-4 rounded-3xl bg-c-wash px-5 py-4 text-c-ink ${focusRing}`}
        data-testid="game-entry"
      >
        <span className="game-entry-logo grid size-14 shrink-0 place-items-center rounded-full bg-c-paper shadow-[inset_0_0_0_1.5px_var(--c-line)]">
          <Logo className="h-10 w-auto" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="font-display block text-[22px] leading-[1.15] tracking-[-0.03em]">{t.title}</b>
          <span className="mt-0.5 block text-sm text-c-grey" data-testid="game-entry-line">
            {best !== null ? (
              <>
                {t.entryBest} <b className="font-num text-[17px] text-c-ink">{best}</b>
              </>
            ) : (
              t.entryNeutral
            )}
          </span>
        </span>
        <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </section>
  );
}
