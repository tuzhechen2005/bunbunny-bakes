import Link from "next/link";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { copy } from "@/copy";

// Customer pages are fixed light (tokens), so the 404 never follows the OS dark mode.
export default function NotFound() {
  return (
    <main className="flex min-h-full w-full flex-1 flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 py-20 text-center">
        <span className="text-muted">
          <BunnyMark size={56} />
        </span>
        <p className="max-w-xs text-base leading-relaxed text-foreground">{copy.errors.NOT_FOUND}</p>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-6 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {copy.customer.order.backHome}
        </Link>
      </div>
    </main>
  );
}
