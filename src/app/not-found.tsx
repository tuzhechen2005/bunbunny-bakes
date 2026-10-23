import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";

// Customer pages are fixed light (D74): the logo, one quiet line, a way home.
export default function NotFound() {
  return (
    <main className="flex min-h-svh w-full flex-1 flex-col items-center justify-center gap-5 bg-c-paper px-5 text-center text-c-ink">
      <Logo label={copy.customer.brand.brandName} className="h-20 w-auto" />
      <p className="max-w-xs text-base leading-relaxed text-c-ink">{copy.errors.NOT_FOUND}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-full bg-c-ink px-6 text-base font-bold text-c-paper active:scale-95"
      >
        {copy.customer.order.backHome}
      </Link>
    </main>
  );
}
