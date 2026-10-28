import type { CSSProperties } from "react";
import "./assistant-orb.css";

/** CSS-only glass orb: the entry's look where WebGL is unavailable (see IridescentOrb). */
export function GlassOrb({ size = 72 }: { size?: number }) {
  return (
    <span className="ao-orb" style={{ "--orb-size": `${size}px` } as CSSProperties} aria-hidden="true">
      <span className="ao-halo" />
      <span className="ao-aura" />
      <span className="ao-sphere" />
      <span className="ao-sheen" />
      <span className="ao-rim" />
      <span className="ao-spec" />
    </span>
  );
}
