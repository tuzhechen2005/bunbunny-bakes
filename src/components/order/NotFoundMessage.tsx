import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { TopBar } from "@/components/ui/TopBar";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";

/**
 * Body of both 404 pages (src/app/not-found.tsx and the order page when the API says 404): the
 * top bar, the logo, one quiet line, a way home. Customer pages are fixed light (D74).
 */
export function NotFoundMessage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[430px] flex-1 flex-col bg-c-paper text-c-ink">
      <TopBar backHref="/" backLabel={copy.customer.brand.back} />
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 pb-20 text-center">
        <Logo label={copy.customer.brand.brandName} className="h-20 w-auto" lazy />
        <p className="max-w-xs text-base leading-relaxed text-c-ink">{copy.errors.NOT_FOUND}</p>
        <Link
          href="/"
          className={`inline-flex min-h-11 items-center rounded-full bg-c-ink px-6 text-base font-bold text-c-paper active:scale-95 ${focusRing}`}
        >
          {copy.customer.order.backHome}
        </Link>
      </div>
    </div>
  );
}
