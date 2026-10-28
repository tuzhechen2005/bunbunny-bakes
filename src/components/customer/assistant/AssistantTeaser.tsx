"use client";

import { useEffect, useState } from "react";

/** First question this long after the orb shows up. */
const FIRST_MS = 1500;
/** Each question stays this long, then the next one comes after the gap. */
const SHOW_MS = 5000;
const GAP_MS = 4000;
/** Once the customer has opened the orb this session, questions keep coming, just less often. */
const GAP_AFTER_USE_MS = 15000;
/** Set once the customer opened the sheet: slower questions for the rest of the session. */
const USED_KEY = "bb_ai_teaser_used";

function readUsed(): boolean {
  try {
    return sessionStorage.getItem(USED_KEY) === "1";
  } catch {
    return false;
  }
}

function markUsed(): void {
  try {
    sessionStorage.setItem(USED_KEY, "1");
  } catch {
    /* ignore: questions just keep their fast pace */
  }
}

/** Set by e2e tests that need the plain orb (a tap during a question would ask it). */
function noTeasers(): boolean {
  return typeof window !== "undefined" && (window as unknown as { __noTeasers?: boolean }).__noTeasers === true;
}

/**
 * The question the orb shows now and then (D120), or null: first after 1.5 s, 5 s each, 4 s apart,
 * always on; after the customer opened the orb this session, 15 s apart.
 */
export function useTeaser(active: boolean, questions: readonly string[]): { question: string | null; used: () => void } {
  // Questions render nothing on the server pass, so reading sessionStorage up front cannot mismatch.
  const [usedBefore, setUsedBefore] = useState(() => typeof window !== "undefined" && readUsed());
  const [shown, setShown] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!active || questions.length === 0 || noTeasers()) return;
    const wait = shown === 0 ? FIRST_MS : usedBefore ? GAP_AFTER_USE_MS : GAP_MS;
    const show = setTimeout(() => setCurrent(questions[shown % questions.length]), wait);
    const hide = setTimeout(() => {
      setCurrent(null);
      setShown((n) => n + 1);
    }, wait + SHOW_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [active, usedBefore, shown, questions]);

  return {
    question: current !== null && active ? current : null,
    used: () => {
      markUsed();
      setUsedBefore(true);
      // Start over from a gap when the orb comes back (not the quick first one).
      setCurrent(null);
      setShown((n) => Math.max(n, 1));
    },
  };
}
