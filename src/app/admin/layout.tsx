import type { Metadata } from "next";

// Admin pages: never indexed, never leak the URL as a referrer (SECURITY.md §2).
// Auth is NOT checked here (the login and reset pages live under this layout):
// each protected admin page calls requireAdminPage() itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="theme-admin flex min-h-full flex-1 flex-col bg-white text-neutral-900">{children}</div>;
}
