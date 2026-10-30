import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_REFRESH_MS, PROGRESS_MIN_GAP_MS, PROGRESS_REPORT_MS } from "@/lib/liveScores";
import { createProgressReporter, startVisibleRefresh } from "@/lib/liveScoreClient";

afterEach(() => vi.useRealTimers());
describe("live score scheduling", () => {
  it("reports full current logs every 10 seconds; retries failures and stops on 404", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: 429 }).mockResolvedValue({ status: 404 });
    let log = [1];
    const reporter = createProgressReporter(() => ({ runId: "run", log }), send);
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS);
    log = [1, 2];
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS * 4);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][0].log).toEqual([1, 2]);
    reporter.stop();
  });
  it("does not queue a throttled exit snapshot behind an in-flight request", async () => {
    vi.useFakeTimers();
    let resolve!: (r: { status: number }) => void;
    const send = vi.fn(() => new Promise<{ status: number }>(r => { resolve = r; }));
    const reporter = createProgressReporter(() => ({ runId: "run", log: [] }), send);
    reporter.flush(); reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    resolve({ status: 200 });
    await Promise.resolve();
    reporter.stop();
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("skips a timer tick shortly after an exit flush, then resumes full-log reports", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({ status: 200 });
    let log = [1];
    const reporter = createProgressReporter(() => ({ runId: "run", log }), send);
    await vi.advanceTimersByTimeAsync(PROGRESS_MIN_GAP_MS);
    reporter.flush();
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS - PROGRESS_MIN_GAP_MS);
    expect(send).toHaveBeenCalledTimes(1);
    log = [1, 2];
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_MS);
    expect(send).toHaveBeenLastCalledWith({ runId: "run", log }, false);
    expect(send).toHaveBeenCalledTimes(2);
    reporter.stop();
  });
  it("refreshes boards only while visible and enabled, and cleans up", async () => {
    vi.useFakeTimers();
    let visible = true, enabled = true;
    const refresh = vi.fn();
    const stop = startVisibleRefresh(refresh, () => visible, () => enabled);
    await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS * 2);
    visible = true; enabled = false;
    await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
    enabled = true;
    await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(BOARD_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
