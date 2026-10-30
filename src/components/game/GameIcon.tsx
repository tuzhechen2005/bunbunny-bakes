import { Logo } from "@/components/brand/Logo";
import type { GameKind } from "@/lib/gameCatalog";

export function GameIcon({ kind }: { kind: GameKind }) {
  return (
    <span className="grid size-14 shrink-0 place-items-center" aria-hidden="true">
      {kind === "M3" ? <svg viewBox="0 0 56 56" className="size-14 text-c-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {[2, 20, 38].map(x => <g key={x} transform={`translate(${x} 20)`}>
          <path d="M0 10C0 4 3 0 8 0s8 4 8 10v9H0z" fill="var(--c-paper)" />
          <path d="m4 5 2 4m4-5 2 4" />
        </g>)}
        <path d="M8 46h40" stroke="var(--c-line)" />
      </svg> : kind === "BIG" ? <Logo className="h-12 w-auto" /> : (
        <span className="relative block h-14 w-[37px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bag.webp" alt="" width={440} height={660} className="h-full w-full" draggable={false} />
          <Logo className="absolute top-[34%] left-[19%] w-[62%]" />
        </span>
      )}
    </span>
  );
}
