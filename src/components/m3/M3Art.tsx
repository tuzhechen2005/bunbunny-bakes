import { memo, useEffect, useState } from "react";
import type { TierView } from "@/components/game/types";
import { photoUrl } from "@/lib/photo";

// One small pre-scaled bitmap per photo, shared by every cell: falling/refilled pieces never
// re-decode or re-scale the original upload (that was the lag on mid-range phones).
const THUMB = 144;
const thumbs = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
function makeThumb(src: string): Promise<string | null> {
  let p = pending.get(src);
  if (!p) {
    p = (async () => {
      try {
        const img = new Image(); img.decoding = "async"; img.src = src; await img.decode();
        const c = document.createElement("canvas"); c.width = c.height = THUMB;
        const g = c.getContext("2d")!; const side = Math.min(img.naturalWidth, img.naturalHeight);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, THUMB, THUMB);
        const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/webp", .85));
        const url = blob ? URL.createObjectURL(blob) : null;
        if (url) thumbs.set(src, url);
        return url;
      } catch { return null; }
    })();
    pending.set(src, p);
  }
  return p;
}
function useThumb(src: string | null) {
  const [url, setUrl] = useState(() => src ? thumbs.get(src) ?? null : null);
  useEffect(() => {
    if (!src || thumbs.has(src)) return;
    let alive = true;
    void makeThumb(src).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [src]);
  return src ? thumbs.get(src) ?? url : null;
}

export const BreadFace = memo(function BreadFace({ tier }: { tier: TierView }) {
  const src = tier.imageUrl ? photoUrl(tier.imageUrl, 256) : null;
  const thumb = useThumb(src);
  return <span className="m3-face" style={{ background: tier.color.bg, color: tier.color.ink }}>
    {thumb ? <span className="m3-face-photo" style={{ backgroundImage: `url(${thumb})` }} />
      : !src ? <span className="font-display">{[...(tier.name ?? "")][0]}</span> : null}
  </span>;
});

/** Keep the face mounted as specials form, with both idle layers below piece effects. */
export function PieceFace({ tier, kind }: { tier: TierView; kind?: "roll" | "big" }) {
  return <span className={`m3-piece-face${kind ? " m3-piece-face-special" : ""}`}>
    <span className="m3-piece-bounce">
      <BreadFace tier={tier} />
      {kind && <SpecialMark kind={kind} />}
    </span>
  </span>;
}

export function SpecialMark({ kind }: { kind: "roll" | "big" }) {
  return <span className={`m3-special m3-special-${kind}`} aria-hidden="true">
    {/* Static SVGs carry the illustration palette and stay crisp at board size. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/brand/art/game/m3-${kind}.webp`} alt="" width={64} height={64} draggable={false} />
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
