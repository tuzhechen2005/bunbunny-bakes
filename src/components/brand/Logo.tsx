/** The owner's bread-bunny logo (public/brand/logo.webp, D80). Decorative unless `label` is given. */
export function Logo({ label, className, lazy = false }: { label?: string; className?: string; lazy?: boolean }) {
  // Plain <img>: a 7 KB static asset, no need for next/image's loader. `lazy` keeps React from
  // emitting a <link rel=preload> for it: use it where the logo is not on the page being loaded
  // (the not-found boundary is part of every page's payload but shown on none of them).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.webp" alt={label ?? ""} width={772} height={951} className={className} loading={lazy ? "lazy" : undefined} draggable={false} />;
}
