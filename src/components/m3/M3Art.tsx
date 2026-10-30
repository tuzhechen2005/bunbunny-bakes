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

/** Flat, token-coloured badges, independent of match orientation. */
export function SpecialMark({ kind }: { kind: "roll" | "big" }) {
  return <svg className={`m3-special m3-special-${kind}`} viewBox="0 0 48 48" aria-hidden="true">
    {kind === "roll" ? <g stroke="var(--c-ink)" strokeWidth="1.8" fill="var(--c-paper)">
      <path d="M4 30h6m28 0h6" strokeWidth="4" strokeLinecap="round" />
      <rect x="10" y="24" width="28" height="12" rx="4" />
      <path d="M15 26v8m18-8v8" opacity=".35" />
    </g> : <>
      <circle cx="24" cy="24" r="21" fill="none" stroke="var(--c-paper)" strokeWidth="5" opacity=".65" />
      <path d="M25 34c0-6 5-10 10-10s10 4 10 10v6H25z" fill="var(--c-paper)" stroke="var(--c-ink)" strokeWidth="1.8" />
      <path d="m30 29 2 4m5-5 2 4" stroke="var(--c-ink)" strokeWidth="1.8" strokeLinecap="round" />
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
