"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { copy } from "@/copy";
import { adminApi, ADMIN_LOGIN_PATH } from "@/lib/adminApi";
import { ADMIN_NAV, isActiveNav } from "./nav";

const t = copy.admin.shell;

const itemClass =
  "flex min-h-12 w-full items-center rounded-lg px-3 text-base text-foreground hover:bg-soft";

/** Mobile-first admin frame: sticky top bar (shop name + menu button) and the page below. */
export function AdminShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function onLogout() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await adminApi("/api/admin/logout", { method: "POST", body: {} });
    // A 401 already redirects (the session is gone either way).
    if (result.ok) {
      window.location.href = ADMIN_LOGIN_PATH;
      return;
    }
    if (result.error !== "UNAUTHORIZED") setError(t.logoutFailed);
    setBusy(false);
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-line bg-card">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
          <Link href="/admin" className="text-lg font-semibold">
            {copy.shopName}
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="admin-menu"
            aria-label={open ? t.closeMenu : t.openMenu}
            onClick={() => setOpen((v) => !v)}
            className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-soft"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        {open && (
          <nav
            id="admin-menu"
            aria-label={t.mainNav}
            className="absolute inset-x-0 top-full border-b border-line bg-card shadow-lg"
          >
            <ul className="mx-auto flex w-full max-w-3xl flex-col gap-1 p-2">
              {ADMIN_NAV.map((item) => {
                const active = isActiveNav(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`${itemClass} ${active ? "bg-soft font-semibold" : ""}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              <li className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={onLogout}
                  disabled={busy}
                  className={`${itemClass} text-danger disabled:opacity-50`}
                >
                  {busy ? t.loggingOut : t.logout}
                </button>
                {error && (
                  <p role="alert" className="px-3 pb-2 text-sm text-danger">
                    {error}
                  </p>
                )}
              </li>
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
