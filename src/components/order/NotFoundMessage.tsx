import Link from "next/link";
import { copy } from "@/copy";

/** Generic 404 body: used by the global not-found page and by the order page on API 404. */
export function NotFoundMessage() {
  return (
    <div className="flex flex-col items-center gap-6 px-4 py-16 text-center">
      <p className="text-4xl" aria-hidden="true">
        🐰
      </p>
      <p className="max-w-xs text-base leading-relaxed text-neutral-700">{copy.errors.NOT_FOUND}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-5 text-base text-neutral-900"
      >
        {copy.customer.order.backHome}
      </Link>
    </div>
  );
}
