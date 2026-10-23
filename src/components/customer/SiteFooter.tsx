import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { fill } from "./format";

/**
 * Big logo + wordmark, plus the owner's WeChat only when the menu returned it (D44).
 * Takes the tint of the current bread (--field at 7%), room at the bottom for the bag bar.
 */
export function SiteFooter({ ownerWechatId }: { ownerWechatId?: string | null }) {
  const b = copy.customer.brand;
  return (
    <footer className="border-t border-[color-mix(in_srgb,var(--field)_12%,var(--c-paper))] bg-[color-mix(in_srgb,var(--field)_7%,var(--c-paper))] px-5 pt-10 pb-[150px] text-[13px] leading-[1.8] text-c-grey">
      <div
        className="mb-4 flex items-end gap-1 font-display text-[26px] leading-none font-black tracking-[-0.03em] text-c-ink"
        role="img"
        aria-label={b.brandName}
      >
        <Logo className="-mb-1.5 h-[54px] w-auto" />
        <span aria-hidden="true">{b.wordmark}</span>
      </div>
      {ownerWechatId ? (
        <p data-testid="footer-contact">{fill(copy.customer.home.footerContact, { id: ownerWechatId })}</p>
      ) : null}
    </footer>
  );
}
