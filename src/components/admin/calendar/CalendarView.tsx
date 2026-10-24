"use client";

import { useCallback, useEffect, useState } from "react";
import { copy } from "@/copy";
import { addDays, localDateOf, parseLocalDate, weekdayOf } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";
import { adminApi } from "@/lib/adminApi";
import type { CalendarResponse } from "@/server/calendar";
import { DaySheet } from "./DaySheet";
import { usageLines } from "./usage";

const t = copy.admin.calendar;

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** First day of a month, "YYYY-MM-01". */
function monthStart(year: number, month: number): LocalDate {
  return `${String(year).padStart(4, "0")}-${pad(month)}-01`;
}

function shiftMonth(first: LocalDate, delta: number): LocalDate {
  const { year, month } = parseLocalDate(first);
  const idx = year * 12 + (month - 1) + delta;
  return monthStart(Math.floor(idx / 12), (idx % 12) + 1);
}

function daysInMonth(first: LocalDate): number {
  const { year, month } = parseLocalDate(first);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Month grid, Sunday-first. */
export function CalendarView() {
  const [today, setToday] = useState<LocalDate | null>(null);
  const [first, setFirst] = useState<LocalDate | null>(null);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LocalDate | null>(null);

  useEffect(() => {
    const d = localDateOf(new Date());
    const { year, month } = parseLocalDate(d);
    // Clock is read on the client after mount (no Date in prerender, no hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(d);
    setFirst(monthStart(year, month));
  }, []);

  const load = useCallback(async (month: LocalDate, signal?: AbortSignal) => {
    const to = addDays(shiftMonth(month, 1), -1);
    const result = await adminApi<CalendarResponse>(
      `/api/admin/calendar?from=${month}&to=${to}`,
      { signal },
    );
    if (signal?.aborted) return;
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.message || t.loadFailed);
    }
  }, []);

  useEffect(() => {
    if (!first) return;
    const ctrl = new AbortController();
    // Fetch on month change; state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(first, ctrl.signal);
    return () => ctrl.abort();
  }, [first, load]);

  function go(delta: number) {
    setData(null);
    setFirst(shiftMonth(first!, delta));
  }

  if (!first) return <p className="text-muted">{t.loading}</p>;

  const { year, month } = parseLocalDate(first);
  const names = Object.fromEntries((data?.independentProducts ?? []).map((p) => [p.id, p.name]));
  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const lead = weekdayOf(first);
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(first) }, (_, i) => `${first.slice(0, 8)}${pad(i + 1)}`),
  ];

  const navBtn =
    "flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-card px-3 text-base";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className={navBtn} aria-label={t.prevMonth} onClick={() => go(-1)}>
          ‹
        </button>
        <h2 className="text-lg font-semibold" aria-live="polite">
          {fill(t.monthLabel, { year, month })}
        </h2>
        <button type="button" className={navBtn} aria-label={t.nextMonth} onClick={() => go(1)}>
          ›
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}{" "}
          <button type="button" className="min-h-11 underline" onClick={() => void load(first)}>
            {t.retry}
          </button>
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {t.weekdays.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" data-testid="calendar-grid">
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />;
          const day = byDate.get(date);
          const over = !!day && (day.over.dough || day.over.delivery || day.over.products.length > 0);
          const open = !!day?.isOpen;
          const { day: dayNum, month: m } = parseLocalDate(date);
          const status = !day ? t.loading : open ? (over ? t.statusOver : t.statusOpen) : t.closed;
          // Fixed cell height: every row of the month is the same height, whatever the text.
          const cls = [
            "flex h-16 min-w-0 flex-col items-stretch overflow-hidden rounded-lg border p-1 text-left text-[10px] leading-tight sm:h-28",
            over ? "border-danger bg-danger/10 text-danger" : open ? "border-line bg-card" : "border-line bg-soft/50 text-muted",
            date === today ? "ring-2 ring-accent" : "",
          ].join(" ");
          const fillPct = day && open ? Math.min(100, Math.round((day.usage.doughG / Math.max(1, day.limits.doughLimitG)) * 100)) : 0;
          return (
            <button
              key={date}
              type="button"
              disabled={!day}
              className={cls}
              data-date={date}
              data-over={over ? "true" : undefined}
              aria-label={fill(t.dayCellLabel, { md: `${m}/${dayNum}`, status })}
              onClick={() => setSelected(date)}
            >
              <span className="text-sm font-semibold">
                {dayNum}
                {date === today && <span className="ml-0.5 hidden text-[10px] font-normal sm:inline">{t.today}</span>}
              </span>
              {day && open && (
                <>
                  {/* Phone: a dough bar and the order count; the numbers are in the day sheet. */}
                  <span className="mt-auto flex flex-col gap-0.5 sm:hidden">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span
                        className={`block h-full rounded-full ${over ? "bg-danger" : "bg-accent"}`}
                        style={{ width: `${fillPct}%` }}
                      />
                    </span>
                    <span className="truncate">{day.orderCount > 0 ? fill(t.compactOrders, { n: day.orderCount }) : "\u00a0"}</span>
                  </span>
                  {/* Wider screens: the full usage, one line each. */}
                  <span className="mt-0.5 hidden flex-col sm:flex">
                    {usageLines(day, names).map((l) => (
                      <span key={l} className="truncate">
                        {l}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {selected && byDate.get(selected) && data && (
        <DaySheet
          key={selected}
          day={byDate.get(selected)!}
          products={data.independentProducts}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void load(first);
          }}
        />
      )}
    </div>
  );
}
