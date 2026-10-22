"use client";

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
  const button = (
    <button
      type="button"
      onClick={onCopy}
      aria-live="polite"
      className={
        prominent
          ? "min-h-11 shrink-0 rounded-lg bg-emerald-600 px-4 text-base font-medium text-white"
          : "min-h-11 shrink-0 rounded-lg border border-neutral-300 px-3 text-sm text-neutral-700"
      }
    >
      {copied ? t.copied : t.copyWechat}
    </button>
  );

  return (
    <section
      data-testid="owner-wechat"
      data-prominent={prominent ? "true" : "false"}
      className={
        prominent
          ? "flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4"
          : "flex items-center gap-3 px-1"
      }
    >
      <p className={prominent ? "min-w-0 flex-1 break-words text-lg font-semibold" : "min-w-0 flex-1 break-words text-sm text-neutral-600"}>
        {label}
      </p>
      {button}
    </section>
  );
}
