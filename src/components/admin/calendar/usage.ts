import { copy } from "@/copy";
import type { CalendarDay } from "@/server/calendar";

const t = copy.admin.calendar;

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Compact usage lines of an open day (PAGES example: 1460 / 1600 g · 布蕾 12 / 24 · 配送 5 / 8). */
export function usageLines(day: CalendarDay, names: Record<string, string>): string[] {
  const lines = [fill(t.usageDough, { used: day.usage.doughG, limit: day.limits.doughLimitG })];
  for (const [id, limit] of Object.entries(day.limits.productLimits)) {
    lines.push(fill(t.usageProduct, { name: names[id] ?? "", used: day.usage.products[id] ?? 0, limit }));
  }
  lines.push(
    day.limits.deliveryEnabled
      ? fill(t.usageDelivery, { used: day.usage.deliveries, limit: day.limits.deliveryLimit })
      : t.deliveryOff,
  );
  return lines;
}
