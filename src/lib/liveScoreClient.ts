import { BOARD_REFRESH_MS, PROGRESS_REPORT_MS } from "./liveScores";

export interface ProgressSnapshot { runId: string; log: readonly unknown[] }
type Send = (snapshot: ProgressSnapshot, exiting: boolean) => Promise<{ status: number }>;

/** One request in flight; failures retry on the next tick, a 404 disables this reporter. */
export function createProgressReporter(read: () => ProgressSnapshot | null, send: Send) {
  let stopped = false, disabled = false, busy = false;
  let pending: ProgressSnapshot | null = null;
  const deliver = (snapshot: ProgressSnapshot, exiting: boolean) => {
    busy = true;
    void (async () => {
      try { if ((await send(snapshot, exiting)).status === 404) disabled = true; }
      catch { /* Reporting never interrupts play. */ }
      finally {
        busy = false;
        const next = pending;
        pending = null;
        if (next && !disabled) deliver(next, true);
      }
    })();
  };
  const flush = (exiting = true) => {
    if (stopped || disabled) return;
    const snapshot = read();
    if (!snapshot) return;
    if (busy) {
      // Preserve the newest exit/hidden snapshot even when the timer request is still pending.
      if (exiting) pending = { ...snapshot, log: [...snapshot.log] };
      return;
    }
    deliver(snapshot, exiting);
  };
  const timer = setInterval(() => flush(false), PROGRESS_REPORT_MS);
  return { flush, stop: () => { stopped = true; clearInterval(timer); } };
}

export function startVisibleRefresh(refresh: () => void, visible: () => boolean, enabled: () => boolean) {
  const timer = setInterval(() => { if (enabled() && visible()) refresh(); }, BOARD_REFRESH_MS);
  return () => clearInterval(timer);
}

// A 404 applies to all three reporters until navigation/reload. Server response flags also
// turn off board timers; progress still probes once so old cached pages honor the kill switch.
let reportingDisabled = false;
export const canReportLiveScores = () => !reportingDisabled;
export async function sendProgress(url: string, snapshot: ProgressSnapshot, exiting: boolean) {
  const body = JSON.stringify(snapshot);
  // Fetch keepalive has a 64 KiB aggregate budget; a large TU log needs ordinary fetch.
  const keepalive = exiting && new TextEncoder().encode(body).length < 60 * 1024;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body, cache: "no-store", keepalive, signal: AbortSignal.timeout(PROGRESS_REPORT_MS - 1000) });
  if (response.status === 404) reportingDisabled = true;
  return response;
}
