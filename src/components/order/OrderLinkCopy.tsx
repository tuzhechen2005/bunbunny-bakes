"use client";

import { copy } from "@/copy";
import { copyText } from "./copyText";
import { useCopied } from "./useCopied";

const t = copy.customer.order;
const focusRing = "focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red";

/** Order link without ?new=1. Only rendered on the client after the order has loaded. */
function orderLink(token: string): string {
  return `${window.location.origin}/o/${encodeURIComponent(token)}`;
}

export function OrderLinkCopy({ token, variant }: { token: string; variant: "banner" | "secondary" }) {
  const [copied, setCopied] = useCopied();
  const link = orderLink(token);

  async function onCopy() {
    if (await copyText(link)) setCopied(true);
  }

  if (variant === "secondary") {
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

  return (
    <div data-testid="order-link" className="flex flex-col gap-3">
      <input
        readOnly
        value={link}
        aria-label={t.copyLink}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-xl bg-c-wash px-3 py-2.5 text-base leading-normal text-c-grey outline-none focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px] focus-visible:outline-c-red"
      />
      <button
        type="button"
        data-testid="copy-link-primary"
        onClick={onCopy}
        aria-live="polite"
        className={`flex min-h-[58px] w-full items-center justify-center rounded-full bg-c-ink text-base font-bold text-c-paper transition-transform active:scale-[0.98] ${focusRing}`}
      >
        {copied ? t.copied : t.copyLink}
      </button>
    </div>
  );
}
