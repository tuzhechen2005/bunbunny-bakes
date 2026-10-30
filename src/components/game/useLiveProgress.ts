"use client";

import { useEffect } from "react";
import { canReportLiveScores, createProgressReporter, sendProgress, type ProgressSnapshot } from "@/lib/liveScoreClient";

/** The reader is stable and reads mutable engine/log refs, including accepted moves mid-animation. */
export function useLiveProgress(url: string, playing: boolean, read: () => ProgressSnapshot | null) {
  useEffect(() => {
    if (!playing) return;
    const reporter = createProgressReporter(() => canReportLiveScores() ? read() : null,
      (snapshot, exiting) => sendProgress(url, snapshot, exiting));
    const hidden = () => { if (document.visibilityState === "hidden") reporter.flush(); };
    const exit = () => reporter.flush();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", exit);
    return () => {
      reporter.flush();
      reporter.stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", exit);
    };
  }, [url, playing, read]);
}
