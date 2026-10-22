"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/copy";
import { fill } from "./types";

const t = copy.customer.order;

/** Fallback for WebViews without navigator.clipboard: select a hidden input and execCommand. */
function legacyCopy(input: HTMLInputElement | null): boolean {
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    const ok = document.execCommand("copy");
    input.blur();
    return ok;
  } catch {
    return false;
  }
}

export function WechatBlock({ ownerWechatId, prominent }: { ownerWechatId: string; prominent: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(ownerWechatId);
        ok = true;
      }
    } catch {
      // fall through to the legacy path
    }
    if (!ok) ok = legacyCopy(inputRef.current);
    if (ok) setCopied(true);
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
      <input
        ref={inputRef}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        value={ownerWechatId}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
      />
    </section>
  );
}
