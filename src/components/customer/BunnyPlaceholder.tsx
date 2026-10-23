import { BunnyMark } from "@/components/brand/BunnyMark";

/** Shared placeholder for products without a photo: the L3 bunny mark on a paper-deep tile (FRONTEND.md section 7). */
export function BunnyPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={`${className ?? ""} flex aspect-square items-center justify-center bg-soft text-muted`}
      aria-hidden="true"
      data-testid="bunny-placeholder"
    >
      <BunnyMark size={48} color="currentColor" />
    </div>
  );
}
