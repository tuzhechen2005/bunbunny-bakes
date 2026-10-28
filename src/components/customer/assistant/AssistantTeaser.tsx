"use client";

import { useEffect, useState } from "react";

/** First question this long after the orb shows up. */
const FIRST_MS = 1500;
/** Each question stays this long, then the next one comes after GAP_MS. */
const SHOW_MS = 5000;
const GAP_MS = 4000;
/** At most this many questions per page visit. */
const MAX_PER_VISIT = 8;
/** Set once the customer opened the sheet: no more questions this session. */
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
    /* ignore: questions just keep showing */
  }
}

/**
 * The question the orb shows now and then (D120), or null: first after 1.5 s, 5 s each, 4 s apart,
 * at most 8 per visit, never again this session once the customer opened the sheet.
 */
export function useTeaser(active: boolean, questions: readonly string[]): { question: string | null; stop: () => void } {
  // Questions render nothing on the server pass, so reading sessionStorage up front cannot mismatch.
  const [off, setOff] = useState(() => typeof window === "undefined" || readOff());
  const [shown, setShown] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!active || off || shown >= MAX_PER_VISIT || questions.length === 0) return;
    const wait = shown === 0 ? FIRST_MS : GAP_MS;
    const show = setTimeout(() => setCurrent(questions[shown % questions.length]), wait);
    const hide = setTimeout(() => {
      setCurrent(null);
      setShown((n) => n + 1);
    }, wait + SHOW_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [active, off, shown, questions]);

  return {
    question: current !== null && active && !off ? current : null,
    stop: () => {
      turnTeasersOff();
      setOff(true);
    },
  };
}
