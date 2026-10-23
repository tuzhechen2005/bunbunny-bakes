/** The owner's bread-bunny logo (public/brand/logo.webp, D80). Decorative unless `label` is given. */
export function Logo({ label, className }: { label?: string; className?: string }) {
  // Plain <img>: a 7 KB static asset, no need for next/image's loader.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.webp" alt={label ?? ""} width={772} height={951} className={className} draggable={false} />;
}
