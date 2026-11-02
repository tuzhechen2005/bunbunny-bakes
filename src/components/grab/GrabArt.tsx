import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { photoUrl } from "@/lib/photo";
import type { GrabItem } from "@/lib/grab";
import type { TierView } from "@/components/game/types";
import { bakedVariants, type BakedSet } from "./grabBake";

// D167 clay sprites; anything without a clay version keeps its original SVG.
const CLAY = new Set(["bunny", "oven", "tongs", "arm", "flour", "butter", "clock", "sparkle"]);
export const grabArtSrc = (name: string) => CLAY.has(name) ? `/brand/art/game/grab-${name}.webp` : `/brand/grab/${name}.svg`;
export function GrabArt({ name, className = "" }: { name: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={grabArtSrc(name)} alt="" draggable={false} className={className} />;
}
export function GrabFace({ item, tiers }: { item: GrabItem; tiers: TierView[] }) {
  const [broken, setBroken] = useState(false);
  const tier = item.tier === null ? null : tiers[item.tier];
  const photo = tier?.imageUrl && !broken ? photoUrl(tier.imageUrl, 256) : null;
  // Breads change their own texture with the oven stage (pale, golden, charcoal); the same <img>
  // node only swaps its src. Until the variants are ready the plain picture shows.
  const bakeSrc = item.stage === "none" ? null : photo ?? grabArtSrc(item.kind);
  const [baked, setBaked] = useState<{ src: string; set: BakedSet } | null>(null);
  useEffect(() => {
    if (!bakeSrc) return;
    let live = true;
    void bakedVariants(bakeSrc).then(set => { if (live && set) setBaked({ src: bakeSrc, set }); });
    return () => { live = false; };
  }, [bakeSrc]);
  const variant = baked && baked.src === bakeSrc && item.stage !== "none" ? baked.set[item.stage] : null;
  return <>
    <span className={`grab-face grab-${item.stage}`}>
      {variant ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={variant} alt="" draggable={false} />
      ) : photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : <GrabArt name={item.kind} />}
      {item.stage === "perfect" && <GrabArt name="sparkle" className="grab-sparkle" />}
    </span>
    {item.stage === "burnt" && <span className="grab-smoke" aria-hidden="true"><i /><i /><i /></span>}
  </>;
}
export function GrabRules() {
  const t = copy.customer.grab;
  return <div className="grab-help-cards">
    {[["tongs", t.tongs, t.tongRule], ["bread", t.bread, t.breadRule], ["clock", t.clock, t.clockRule]].map(([art, title, text]) =>
      <div key={art} className="grab-help-card" data-testid={`grab-help-${art}`}>
        <GrabArt name={art} /><b className="font-display">{title}</b><span>{text}</span>
      </div>)}
  </div>;
}
