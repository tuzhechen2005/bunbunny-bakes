"use client";

import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { copyText } from "./copyText";
import { fill } from "./types";
import { useCopied } from "./useCopied";

const t = copy.customer.order;

export function WechatBlock({ ownerWechatId, prominent }: { ownerWechatId: string; prominent: boolean }) {
  const [copied, setCopied] = useCopied();

  async function onCopy() {
    if (await copyText(ownerWechatId)) setCopied(true);
  }

  const label = fill(t.addOwnerWechat, { ownerWechatId });

  return (
    <section
      data-testid="owner-wechat"
      data-prominent={prominent ? "true" : "false"}
      className="mt-[18px] flex items-center justify-between gap-3"
    >
      <p
        className={`min-w-0 flex-1 break-words text-sm leading-snug ${prominent ? "font-bold text-c-ink" : "font-medium text-c-grey"}`}
      >
        {label}
      </p>
      <button
        type="button"
        onClick={onCopy}
        aria-live="polite"
        className={`min-h-11 shrink-0 rounded-full px-4 text-[13px] font-bold ${prominent ? "bg-c-ink text-c-paper" : "border-[1.5px] border-c-ink text-c-ink"} ${focusRing}`}
      >
        {copied ? t.copied : t.copyWechat}
      </button>
    </section>
  );
}
