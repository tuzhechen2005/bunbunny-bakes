import Link from "next/link";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { copy } from "@/copy";

/** Generic 404 body: used by the global not-found page and by the order page on API 404. */
export function NotFoundMessage() {
  return (
    <div className="flex flex-col items-center gap-6 px-4 py-16 text-center">
      <BunnyMark size={56} color="var(--caramel)" />
      <p className="max-w-xs text-base leading-relaxed text-ink">{copy.errors.NOT_FOUND}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-5 text-base text-ink active:bg-soft"
      >
        {copy.customer.order.backHome}
      </Link>
    </div>
  );
}
