import { dayLabel } from "@/domain/dates";
import { copy } from "@/copy";
import type { Next14Day } from "@/server/dashboard";
import { AdminCard } from "../AdminCard";
import { fill } from "./fill";

const t = copy.admin.dashboard;

/** One row per day: date, dough bar (red when over a limit), usage text. */
export function Next14Strip({ days }: Readonly<{ days: Next14Day[] }>) {
  return (
    <AdminCard title={t.next14Title}>
      <ul className="space-y-3" data-testid="next14">
        {days.map((d) => {
          const pct = d.doughLimitG > 0 ? Math.min(100, Math.round((d.doughG / d.doughLimitG) * 100)) : d.doughG > 0 ? 100 : 0;
          return (
            <li key={d.date} data-over={d.over ? "true" : "false"} className={d.isOpen ? "" : "opacity-60"}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{dayLabel(d.date)}</span>
                <span className={d.over ? "font-medium text-danger" : "text-muted"}>
                  {d.over ? t.next14Over : d.isOpen ? "" : t.next14Closed}
                </span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full bg-soft"
                role="img"
                aria-label={fill(t.dough, { used: d.doughG, limit: d.doughLimitG })}
              >
                <div
                  className={`h-full ${d.over ? "bg-danger" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {(d.isOpen || d.doughG > 0) && (
                <p className="mt-1 text-xs text-muted">
                  {fill(t.next14Row, {
                    used: d.doughG,
                    limit: d.doughLimitG,
                    deliveries: d.deliveries,
                    deliveryLimit: d.deliveryLimit,
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </AdminCard>
  );
}
