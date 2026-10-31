import "./run.css";
import { copy } from "@/copy";
import { manifest, type AssetName } from "./runAssets";
/** Static sheet crop; used in the hub/menu without a Canvas or animation loop. */
export function RunSprite({ name, className = "" }: { name: AssetName; className?: string }) {
  const a = manifest.assets[name];
  return <span aria-hidden="true" className={`run-sprite ${className}`} style={{
    aspectRatio: `${a.frameSize[0]} / ${a.frameSize[1]}`,
    backgroundImage: `url(${manifest.baseUrl}${a.file})`,
    backgroundSize: `${a.columns * 100}% ${a.rows * 100}%`,
  }} />;
}
export function RunRules() {
  const t = copy.customer.run;
  return <>
    <div className="run-help-cards">
      {([['bunny-lean',t.laneRule],['bunny-jump',t.jumpRule],['bunny-slide',t.slideRule]] as const).map(([name,label]) =>
        <div key={name} className="run-help-card"><RunSprite name={name} /><b>{label}</b></div>)}
    </div>
    <p className="mt-3 text-xs text-c-grey">{t.scoreRule}</p>
    <p className="mt-1 text-xs text-c-grey">{t.powers}</p>
  </>;
}
