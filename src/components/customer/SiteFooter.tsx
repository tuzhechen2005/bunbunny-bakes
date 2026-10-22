import { copy } from "@/copy";
import { fill } from "./format";

/** Shop name, plus the owner's WeChat only when the menu returned it (D44). */
export function SiteFooter({ ownerWechatId }: { ownerWechatId?: string | null }) {
  return (
    <footer className="mt-8 border-t border-line px-4 py-6 text-center text-sm text-muted">
      <p>{copy.shopName}</p>
      {ownerWechatId ? (
        <p className="mt-1" data-testid="footer-contact">
          {fill(copy.customer.home.footerContact, { id: ownerWechatId })}
        </p>
      ) : null}
    </footer>
  );
}
