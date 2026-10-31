import { useState } from "react";
import type { TierView } from "@/components/game/types";
import { photoUrl } from "@/lib/photo";

export function BreadFace({ tier }: { tier: TierView }) {
  const [broken, setBroken] = useState(false);
  return <span className="m3-face" style={{ background: tier.color.bg, color: tier.color.ink }}>
    {tier.imageUrl && !broken ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl(tier.imageUrl, 256)} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
    ) : <span className="font-display">{[...(tier.name ?? "")][0]}</span>}
  </span>;
}

/** Separate breathing and hop layers keep idle motion off the piece's effect transform. */
export function SpecialMark({ kind }: { kind: "roll" | "big" }) {
  return <span className={`m3-special m3-special-${kind}`} aria-hidden="true">
    {/* Static SVGs carry the illustration palette and stay crisp at board size. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/brand/m3/${kind}.svg`} alt="" width={64} height={64} draggable={false} />
  </span>;
}

export function BoardPaper() {
  return <svg className="m3-paper" viewBox="0 0 320 320" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="m3-paper-grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0v40" fill="none" stroke="var(--c-line)" strokeWidth="1" />
      <path d="M7 9h2m18 18h1M9 31h1" stroke="var(--c-grey)" opacity=".13" />
    </pattern></defs>
    <rect width="320" height="320" fill="var(--c-wash)" />
    <rect width="320" height="320" fill="url(#m3-paper-grid)" />
  </svg>;
}
