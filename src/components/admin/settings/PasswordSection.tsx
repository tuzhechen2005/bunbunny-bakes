"use client";

import { useState, type FormEvent } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";

const t = copy.admin.settings.password;

const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-background px-3 py-2 text-base text-foreground focus:border-accent focus:outline-none";

export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setDone(false);
    if (next.length < 10) return setError(t.tooShort);
    if (next !== confirm) return setError(t.mismatch);
    setError(null);
    setPending(true);
    const result = await adminApi("/api/admin/password", {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    });
    setPending(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } else {
      setError(result.message);
    }
  }

  return (
    <AdminCard title={t.title}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.current}</span>
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            className={inputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.new}</span>
          <input
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            className={inputClass}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t.confirm}</span>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-lg bg-accent px-4 text-base font-medium text-accent-ink disabled:bg-disabled disabled:text-disabled-ink"
        >
          {pending ? t.submitting : t.submit}
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="text-sm text-muted">
            {t.done}
          </p>
        )}
      </form>
    </AdminCard>
  );
}
