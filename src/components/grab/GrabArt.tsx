import { useEffect, useState } from "react";
import { copy } from "@/copy";
import { photoUrl } from "@/lib/photo";
import type { GrabItem } from "@/lib/grab";
import type { TierView } from "@/components/game/types";
import { bakedVariants, goldenVariants, type BakedSet, type GoldenSet } from "./grabBake";

// D167 clay sprites; anything without a clay version keeps its original SVG.
const CLAY = new Set(["bunny", "oven", "tongs", "arm", "flour", "butter", "clock", "sparkle", "bomb", "boom", "bomb-card"]);
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
  // Golden bread has its own gilded picture until it burns (burnt golden bread is charcoal like any other).
  const goldSrc = item.golden && bakeSrc && item.stage !== "burnt" ? bakeSrc : null;
  const [gold, setGold] = useState<{ src: string; set: GoldenSet } | null>(null);
  useEffect(() => {
    if (!goldSrc) return;
    let live = true;
    void goldenVariants(goldSrc).then(set => { if (live && set) setGold({ src: goldSrc, set }); });
    return () => { live = false; };
  }, [goldSrc]);
  const variant = goldSrc && gold && gold.src === goldSrc && (item.stage === "raw" || item.stage === "perfect") ? gold.set[item.stage]
    : baked && baked.src === bakeSrc && item.stage !== "none" ? baked.set[item.stage] : null;
  return <>
    <span className={`grab-face grab-${item.stage}`}>
      {variant ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={variant} alt="" draggable={false} />
      ) : photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : <GrabArt name={item.kind} />}
      {item.stage === "perfect" && !item.golden && <GrabArt name="sparkle" className="grab-sparkle" />}
      {item.golden && item.stage !== "burnt" && <><GrabArt name="sparkle" className="grab-sparkle" /><GrabArt name="sparkle" className="grab-sparkle grab-sparkle-b" /></>}
    </span>
    {item.stage === "burnt" && <span className="grab-smoke" aria-hidden="true"><i /><i /><i /></span>}
  </>;
}
export function GrabRules() {
  const t = copy.customer.grab;
  return <div className="grab-help-cards">
    {[["tongs", t.tongs, t.tongRule], ["bread", t.bread, t.breadRule], ["clock", t.clock, t.clockRule], ["bomb-card", t.bomb, t.bombRule]].map(([art, title, text]) =>
      <div key={art} className="grab-help-card" data-testid={`grab-help-${art}`}>
        <GrabArt name={art} /><b className="font-display">{title}</b><span>{text}</span>
      </div>)}
  </div>;
}
