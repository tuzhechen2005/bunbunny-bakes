/**
 * Stand-in for a product without a photo (customer home, admin lists): a wash tile with a faint
 * bread-bunny logo (public/brand/logo.webp, a CSS background so the tile contains no <img>).
 * The caller's className fixes the size.
 */
export function BunnyPlaceholder({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center overflow-hidden bg-c-wash ${className}`}
      data-testid="bunny-placeholder"
      aria-hidden="true"
    >
      <span className="h-3/5 w-3/5 bg-[url('/brand/logo.webp')] bg-contain bg-center bg-no-repeat opacity-25" />
    </span>
  );
}
