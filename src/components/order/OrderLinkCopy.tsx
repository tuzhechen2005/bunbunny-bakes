"use client";

import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { copyText } from "./copyText";
import { useCopied } from "./useCopied";

const t = copy.customer.order;

/** Order link without ?new=1. Only rendered on the client after the order has loaded. */
function orderLink(token: string): string {
  return `${window.location.origin}/o/${encodeURIComponent(token)}`;
}

/** The quiet 复制订单链接 button of the order page (the save-link dialog has the big one). */
export function OrderLinkCopy({ token }: { token: string }) {
  const [copied, setCopied] = useCopied();

  async function onCopy() {
    if (await copyText(orderLink(token))) setCopied(true);
  }

  return (
    <button
      type="button"
      data-testid="copy-link-secondary"
      onClick={onCopy}
      aria-live="polite"
      className={`min-h-[52px] w-full rounded-full border-[1.5px] border-c-ink text-[15px] font-bold text-c-ink transition-transform active:scale-[0.98] ${focusRing}`}
    >
      {copied ? t.copied : t.copyLink}
    </button>
  );
}
