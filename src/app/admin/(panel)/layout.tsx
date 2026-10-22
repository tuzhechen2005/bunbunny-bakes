import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminPage } from "@/server/session";

// Every logged-in admin page lives under this route group (login and reset stay
// outside it). The session is validated against the database here; pages that read
// data should still call requireAdmin()/requireAdminPage() themselves, because a
// layout does not guard the page rendered inside it (SECURITY.md §3).
async function Gate({ children }: Readonly<{ children: ReactNode }>) {
  await requireAdminPage();
  return <AdminShell>{children}</AdminShell>;
}

export default function AdminPanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Suspense fallback={null}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
