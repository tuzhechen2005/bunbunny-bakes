import { copy } from "@/copy";

const t = copy.admin.shell;

export interface AdminNavItem {
  href: string;
  label: string;
}

/** Order matters: top bar menu and the dashboard quick links both use it. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin/orders", label: t.orders },
  { href: "/admin/calendar", label: t.calendar },
  { href: "/admin/orders/new", label: t.newOrder },
  { href: "/admin/products", label: t.products },
  { href: "/admin/settings", label: t.settings },
  { href: "/admin/logs", label: t.logs },
];

/** The quick links of PAGES.md `/admin` (everything except the logs). */
export const ADMIN_QUICK_LINKS: readonly AdminNavItem[] = ADMIN_NAV.filter(
  (item) => item.href !== "/admin/logs",
);

/** True when `pathname` is the item's page or below it; /admin/orders/new only matches itself. */
export function isActiveNav(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(href + "/")) return false;
  // "订单" must not light up on /admin/orders/new (代客下单 has its own item).
  return !(href === "/admin/orders" && pathname.startsWith("/admin/orders/new"));
}
