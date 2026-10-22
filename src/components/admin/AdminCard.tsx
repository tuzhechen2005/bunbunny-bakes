import type { ReactNode } from "react";

/** A white rounded card with an optional heading, for admin page sections. */
export function AdminCard({
  title,
  children,
  className = "",
}: Readonly<{ title?: string; children: ReactNode; className?: string }>) {
  return (
    <section className={`rounded-xl border border-line bg-card p-4 ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
