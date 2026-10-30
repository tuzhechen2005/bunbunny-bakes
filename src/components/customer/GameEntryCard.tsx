"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { useGameHub } from "@/components/game/useGameHub";
import { copy } from "@/copy";
import { focusRing } from "@/components/ui/focus";
import { fill } from "./format";
import "@/components/game/game.css";

const t = copy.customer.gameHub;

/** One quiet entrance to the games; keep the original heartbeat and lazy request. */
export function GameEntryCard() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const { data } = useGameHub(near);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let idle: number | undefined;
    const load = () => { idle = window.setTimeout(() => setNear(true), 400); };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => clearTimeout(idle);
    }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load();
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(idle); };
  }, []);

  const prize = data?.games.find((game) => game.kind === data.prizeGame);
  return (
    <section className="px-5 pt-2 pb-7">
      <div ref={ref} data-testid="game-entry-card">
        <Link href="/game/hub" className={`game-entry flex min-h-24 items-center gap-4 rounded-3xl bg-c-wash px-5 py-5 text-c-ink ${focusRing}`} data-testid="game-entry">
          <span className="game-entry-logo grid size-14 shrink-0 place-items-center rounded-full bg-c-paper">
            <Logo className="h-10 w-auto" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[24px] leading-tight font-bold tracking-[-0.03em]">{t.title}</b>
            <span className="mt-1.5 block text-[13px] text-c-grey" data-testid="game-entry-line">
              {prize ? <span data-testid="game-entry-prize">{fill(t.entryPrize, { game: prize.name })}</span> : copy.customer.game.entryNeutral}
            </span>
          </span>
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </Link>
      </div>
    </section>
  );
}
