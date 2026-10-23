import { BunnyMark } from "@/components/brand/BunnyMark";
import { copy } from "@/copy";
import { fill } from "./format";

/** Shop name, plus the owner's WeChat only when the menu returned it (D44). */
export function SiteFooter({ ownerWechatId }: { ownerWechatId?: string | null }) {
  return (
    <footer className="mt-12 flex flex-col items-center border-t border-line pt-6 pb-4 text-center text-sm text-muted">
      <BunnyMark size={24} />
      <p className="mt-2 font-serif text-base text-foreground" aria-label={copy.shopName}>
        {copy.customer.home.wordmark}
      </p>
      {ownerWechatId ? (
        <p className="mt-1" data-testid="footer-contact">
          {fill(copy.customer.home.footerContact, { id: ownerWechatId })}
        </p>
      ) : null}
    </footer>
  );
}
