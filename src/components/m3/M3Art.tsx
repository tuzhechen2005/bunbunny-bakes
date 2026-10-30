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

/** Bold, token-coloured marks that read at a glance on a 40px piece. */
export function SpecialMark({ kind }: { kind: "roll" | "big" }) {
  return <svg className={`m3-special m3-special-${kind}`} viewBox="0 0 48 48" aria-hidden="true">
    {kind === "roll" ? <>
      <rect x="1.5" y="1.5" width="45" height="45" rx="10" fill="none" stroke="var(--c-ink)" strokeWidth="3" />
      <path d="M3 32h42" stroke="var(--c-ink)" strokeWidth="6" strokeLinecap="round" />
      <rect x="10" y="26" width="28" height="12" rx="6" fill="var(--c-paper)" stroke="var(--c-ink)" strokeWidth="3" />
    </> : <>
      <rect x="2" y="2" width="44" height="44" rx="10" fill="none" stroke="var(--c-ink)" strokeWidth="4" />
      <rect x="5.5" y="5.5" width="37" height="37" rx="7" fill="none" stroke="var(--c-paper)" strokeWidth="2.5" />
      <circle cx="37" cy="11" r="10" fill="var(--c-ink)" />
      <path d="M37 4.5l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6-4.6-1.9 4.6-1.9z" fill="var(--c-paper)" />
    </>}
  </svg>;
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
