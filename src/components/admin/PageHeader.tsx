import Link from "next/link";
import type { ReactNode } from "react";
import { copy } from "@/copy";

/** Page title row for admin pages: optional back link, h1, optional right-side actions. */
export function PageHeader({
  title,
  backHref,
  actions,
}: Readonly<{ title: string; backHref?: string; actions?: ReactNode }>) {
  return (
    <div className="mb-4">
      {backHref && (
        <Link href={backHref} className="mb-1 inline-flex min-h-11 items-center text-sm text-muted">
          {copy.admin.shell.back}
        </Link>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
