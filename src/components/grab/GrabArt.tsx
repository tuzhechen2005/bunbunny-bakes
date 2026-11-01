import { useState } from "react";
import { copy } from "@/copy";
import { photoUrl } from "@/lib/photo";
import type { GrabItem } from "@/lib/grab";
import type { TierView } from "@/components/game/types";

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
  return <span className={`grab-face grab-${item.stage}`}>
    {tier?.imageUrl && !broken ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl(tier.imageUrl, 256)} alt="" draggable={false} onError={() => setBroken(true)} />
    ) : <GrabArt name={item.kind} />}
    {item.stage === "perfect" && <GrabArt name="sparkle" className="grab-sparkle" />}
  </span>;
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
