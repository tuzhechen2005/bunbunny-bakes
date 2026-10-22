"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import type { Dashboard as DashboardData } from "@/server/dashboard";
import { AdminCard } from "../AdminCard";
import { DayCardView } from "./DayCardView";
import { Next14Strip } from "./Next14Strip";
import { OrderingSwitch } from "./OrderingSwitch";
import { fill } from "./fill";

const t = copy.admin.dashboard;

/** Loads the dashboard through the protected API and renders it. */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await adminApi<DashboardData>("/api/admin/dashboard");
    if (result.ok) setData(result.data);
    else setError(result.message);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!data) {
    return error ? (
      <div className="space-y-3">
        <p role="alert" className="text-danger">
          {error}
        </p>
        <button type="button" onClick={() => void load()} className="min-h-11 rounded-lg border border-line px-4">
          {t.retry}
        </button>
      </div>
    ) : (
      <p className="text-muted">{t.loading}</p>
    );
  }

  const reminderHref = `/admin/orders?date=${data.tomorrow}&status=NEW&status=CONTACTED`;

  return (
    <div className="space-y-4">
      <OrderingSwitch
        enabled={data.orderingEnabled}
        onChanged={(orderingEnabled) => setData({ ...data, orderingEnabled })}
      />

      {data.unconfirmedTomorrow > 0 && (
        <Link
          href={reminderHref}
          className="flex min-h-12 items-center rounded-xl border border-accent bg-soft px-4 text-base font-medium"
        >
          {fill(t.unconfirmed, { n: data.unconfirmedTomorrow })}
        </Link>
      )}
      {data.failedNotifications > 0 && (
        <Link
          href="/admin/logs"
          className="flex min-h-12 items-center rounded-xl border border-danger px-4 text-base font-medium text-danger"
        >
          {fill(t.failedNotifications, { n: data.failedNotifications })}
        </Link>
      )}

      <DayCardView title={t.today} date={data.today} card={data.days[data.today]} testId="card-today" />
      <DayCardView
        title={t.tomorrow}
        date={data.tomorrow}
        card={data.days[data.tomorrow]}
        testId="card-tomorrow"
      />

      <AdminCard title={t.tonightTitle}>
        {data.tonightBrulee.length === 0 ? (
          <p className="text-muted">{t.tonightNone}</p>
        ) : (
          <ul className="space-y-1 text-base" data-testid="tonight">
            {data.tonightBrulee.map((l) => (
              <li key={l.productId}>
                {l.batches === null
                  ? fill(t.tonightLineNoBatch, { name: l.name, qty: l.qty })
                  : fill(t.tonightLine, {
                      name: l.name,
                      qty: l.qty,
                      batches: l.batches,
                      leftover: l.leftover ?? 0,
                    })}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <Next14Strip days={data.next14} />
    </div>
  );
}
