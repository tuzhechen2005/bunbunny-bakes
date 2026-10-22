import type { Metadata } from "next";
import Link from "next/link";
import { AdminCard } from "@/components/admin/AdminCard";
import { PageHeader } from "@/components/admin/PageHeader";
import { ADMIN_QUICK_LINKS } from "@/components/admin/nav";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.shell.dashboardTitle} · ${copy.shopName}`,
};

// TEMPORARY placeholder: a later task replaces it with the real dashboard.
export default function AdminHomePage() {
  return (
    <>
      <PageHeader title={copy.admin.shell.dashboardTitle} />
      <AdminCard title={copy.admin.shell.quickLinks}>
        <ul className="grid grid-cols-2 gap-3">
          {ADMIN_QUICK_LINKS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-14 items-center justify-center rounded-lg border border-line bg-soft text-base font-medium"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </AdminCard>
    </>
  );
}
