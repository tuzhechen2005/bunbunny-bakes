"use client";

import { useEffect, useState } from "react";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";

const t = copy.customer.assistant;

/** First bubble this long after the orb shows up. */
const FIRST_MS = 2500;
/** Each bubble stays this long, then the next one comes after GAP_MS. */
const SHOW_MS = 5000;
const GAP_MS = 9000;
/** At most this many bubbles per page visit. */
const MAX_PER_VISIT = 3;
/** Set once the customer opened the sheet or closed a bubble: no more bubbles this session. */
const OFF_KEY = "bb_ai_teaser_off";

function readOff(): boolean {
  try {
    return sessionStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function turnTeasersOff(): void {
  try {
    sessionStorage.setItem(OFF_KEY, "1");
  } catch {
    /* ignore: bubbles just keep showing */
  }
}

export interface AssistantTeaserProps {
  /** The orb is on screen and the sheet is closed. */
  active: boolean;
  questions: readonly string[];
  /** Tap on the bubble: open the sheet and ask this question. */
  onAsk: (question: string) => void;
}

/**
 * A small question bubble beside the orb now and then (D120): first after 2.5 s, 5 s each, 9 s apart,
 * at most 3 per visit, never again this session once the customer opened the sheet or closed one.
 */
export function AssistantTeaser({ active, questions, onAsk }: AssistantTeaserProps) {
  // Bubbles render nothing on the server pass, so reading sessionStorage up front cannot mismatch.
  const [off, setOff] = useState(() => typeof window === "undefined" || readOff());
  const [shown, setShown] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!active || off || shown >= MAX_PER_VISIT || questions.length === 0) return;
    const show = setTimeout(
      () => {
        setCurrent(questions[shown % questions.length]);
      },
      shown === 0 ? FIRST_MS : GAP_MS,
    );
    const hide = setTimeout(
      () => {
        setCurrent(null);
        setShown((n) => n + 1);
      },
      (shown === 0 ? FIRST_MS : GAP_MS) + SHOW_MS,
    );
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [active, off, shown, questions]);

  const visible = current !== null && active && !off;
  return (
    <div
      className={`pointer-events-auto mr-2 flex max-w-[220px] items-center self-center rounded-2xl rounded-br-md bg-c-paper shadow-[0_8px_24px_-10px_rgba(0,0,0,0.35)] ring-1 ring-c-line transition-[opacity,transform] duration-300 motion-reduce:transition-opacity ${
        visible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-2 opacity-0"
      }`}
      inert={!visible}
      aria-live="polite"
      data-testid="assistant-teaser"
    >
      <button
        type="button"
        onClick={() => {
          if (!current) return;
          turnTeasersOff();
          setOff(true);
          onAsk(current);
        }}
        className={`min-h-11 flex-1 py-2 pl-3.5 text-left text-sm leading-snug font-bold text-c-ink ${focusRing}`}
        data-testid="assistant-teaser-ask"
      >
        {current ?? ""}
      </button>
      <button
        type="button"
        onClick={() => {
          turnTeasersOff();
          setOff(true);
        }}
        aria-label={t.teaserClose}
        className={`grid size-11 shrink-0 place-items-center text-c-grey ${focusRing}`}
        data-testid="assistant-teaser-close"
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
