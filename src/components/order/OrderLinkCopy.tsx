"use client";

import { copy } from "@/copy";
import { copyText } from "./copyText";
import { useCopied } from "./useCopied";

const t = copy.customer.order;

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
      <div className="flex justify-center">
        <button
          type="button"
          data-testid="copy-link-secondary"
          onClick={onCopy}
          aria-live="polite"
          className="min-h-11 rounded-lg border border-neutral-300 px-4 text-sm text-neutral-700"
        >
          {copied ? t.copied : t.copyLink}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="order-link" className="mt-3 flex flex-col gap-2">
      <input
        readOnly
        value={link}
        aria-label={t.copyLink}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-800"
      />
      <button
        type="button"
        data-testid="copy-link-primary"
        onClick={onCopy}
        aria-live="polite"
        className="min-h-12 w-full rounded-lg bg-emerald-600 px-4 text-base font-semibold text-white"
      >
        {copied ? t.copied : t.copyLink}
      </button>
    </div>
  );
}
