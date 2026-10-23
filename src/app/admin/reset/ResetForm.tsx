"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { copy } from "@/copy";

const t = copy.admin.auth;
const MIN_PASSWORD_LENGTH = 10; // = MIN_PASSWORD_LENGTH in src/server/auth.ts

const inputClass =
  "w-full rounded-lg border border-line bg-card px-3 py-3 text-base focus:border-accent focus:outline-none";
const buttonClass =
  "w-full rounded-lg bg-accent py-3 text-base font-medium text-accent-ink disabled:opacity-50";

function BackToLogin() {
  return (
    <Link href="/admin/login" className="self-center py-2 text-sm text-muted underline">
      {t.backToLogin}
    </Link>
  );
}

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-danger">
          {t.resetInvalid}
        </p>
        <BackToLogin />
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-center text-base">
          {t.resetDone}
        </p>
        <BackToLogin />
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t.passwordTooShort);
    if (password !== confirm) return setError(t.passwordMismatch);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/password-reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (response.ok) {
        setDone(true);
      } else {
        let message: string = t.requestFailed;
        try {
          const body = (await response.json()) as { message?: unknown };
          if (typeof body.message === "string" && body.message) message = body.message;
        } catch {
          // not JSON
        }
        setError(message);
      }
    } catch {
      setError(t.requestFailed);
    }
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{t.newPassword}</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{t.confirmPassword}</span>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className={buttonClass} disabled={submitting}>
          {submitting ? t.saving : t.saveNewPassword}
        </button>
      </form>
      <BackToLogin />
    </div>
  );
}
