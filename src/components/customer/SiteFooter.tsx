import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { fill } from "./format";

/**
 * Big logo + wordmark, plus the owner's WeChat only when the menu returned it (D44).
 * `home` (the home page only): tinted with the current bread (--field at 7%) and with room at the
 * bottom for the fixed bag bar. Everywhere else (checkout) the footer is neutral.
 */
export function SiteFooter({ ownerWechatId, home = false }: { ownerWechatId?: string | null; home?: boolean }) {
  const b = copy.customer.brand;
  const skin = home
    ? "border-[color-mix(in_srgb,var(--field)_12%,var(--c-paper))] bg-[color-mix(in_srgb,var(--field)_7%,var(--c-paper))] pt-10 pb-[150px]"
    : "border-c-line bg-c-paper pt-8 pb-10";
  return (
    <footer className={`border-t px-5 text-[13px] leading-[1.8] text-c-grey ${skin}`}>
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
