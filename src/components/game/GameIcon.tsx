import { Logo } from "@/components/brand/Logo";
import type { GameKind } from "@/lib/gameCatalog";

export function GameIcon({ kind }: { kind: GameKind }) {
  return (
    <span className="grid size-14 shrink-0 place-items-center" aria-hidden="true">
      {kind === "M3" || kind === "GRAB" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kind === "GRAB" ? "/brand/grab/icon.svg" : "/brand/m3.svg"} alt="" width={56} height={56} className="size-14" draggable={false} />
      ) : kind === "BIG" ? <Logo className="h-12 w-auto" /> : (
        <span className="relative block h-14 w-[37px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bag.webp" alt="" width={440} height={660} className="h-full w-full" draggable={false} />
          <Logo className="absolute top-[34%] left-[19%] w-[62%]" />
        </span>
      )}
    </span>
  );
}
