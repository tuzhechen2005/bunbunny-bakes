import "./assistant-orb.css";

/** CSS-only glass orb: the entry's look where WebGL is unavailable (see IridescentOrb). */
export function GlassOrb() {
  return (
    <span className="ao-orb" aria-hidden="true">
      <span className="ao-halo" />
      <span className="ao-aura" />
      <span className="ao-sphere" />
      <span className="ao-sheen" />
      <span className="ao-rim" />
      <span className="ao-spec" />
    </span>
  );
}
