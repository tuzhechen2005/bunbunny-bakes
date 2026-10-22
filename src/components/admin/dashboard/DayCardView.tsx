import { dayLabel } from "@/domain/dates";
import type { OrderStatus } from "@/domain/types";
import { copy } from "@/copy";
import type { DayCard } from "@/server/dashboard";
import { AdminCard } from "../AdminCard";
import { fill } from "./fill";

const t = copy.admin.dashboard;
const STATUS_ORDER: OrderStatus[] = [
  "NEW",
  "CONTACTED",
  "CONFIRMED",
  "BAKING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
];

/** Today / tomorrow card. `title` is 今天 or 明天. */
export function DayCardView({
  title,
  date,
  card,
  testId,
}: Readonly<{ title: string; date: string; card: DayCard; testId: string }>) {
  const orderCount = Object.values(card.byStatus).reduce((a, b) => a + b, 0);
  const closedEmpty = !card.isOpen && orderCount === 0;

  return (
    <AdminCard title={`${title} · ${dayLabel(date)}`}>
      <div data-testid={testId} className="space-y-2 text-base">
        {closedEmpty ? (
          <p className="text-muted">{title === copy.admin.dashboard.tomorrow ? t.closedTomorrow : t.closedDay}</p>
        ) : (
          <>
            {!card.isOpen && <p className="text-sm text-muted">{t.closedDay}</p>}
            {orderCount === 0 && <p className="text-muted">{t.noOrders}</p>}
            <ul className="space-y-1">
              {card.products.map((p) => (
                <li key={p.productId}>
                  {p.rounds
                    ? `${p.name} ${fill(t.cheeseRounds, { qty: p.qty, rounds: p.rounds.rounds, leftover: p.rounds.leftover })}`
                    : fill(t.productQty, { name: p.name, qty: p.qty })}
                </li>
              ))}
            </ul>
            <p className={card.doughG > card.doughLimitG ? "font-medium text-danger" : ""}>
              {fill(t.dough, { used: card.doughG, limit: card.doughLimitG })}
            </p>
            {card.independent.map((p) => (
              <p key={p.productId} className={p.qty > p.limit ? "font-medium text-danger" : ""}>
                {fill(t.independent, { name: p.name, qty: p.qty, limit: p.limit })}
              </p>
            ))}
            <p className={card.deliveries > card.deliveryLimit ? "font-medium text-danger" : ""}>
              {card.deliveryEnabled
                ? fill(t.deliveries, { used: card.deliveries, limit: card.deliveryLimit })
                : t.deliveryOff}
            </p>
            {orderCount > 0 && (
              <ul className="flex flex-wrap gap-2 pt-1">
                {STATUS_ORDER.filter((s) => card.byStatus[s] > 0).map((s) => (
                  <li key={s} className="rounded-full bg-soft px-3 py-1 text-sm">
                    {t.statusLabels[s]} {card.byStatus[s]}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminCard>
  );
}
