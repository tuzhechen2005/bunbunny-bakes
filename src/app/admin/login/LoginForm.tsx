"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { copy } from "@/copy";

const t = copy.admin.auth;

const inputClass =
  "w-full rounded-lg border border-line bg-card px-3 py-3 text-base focus:border-accent focus:outline-none";
const buttonClass =
  "w-full rounded-lg bg-accent py-3 text-base font-medium text-accent-ink disabled:opacity-50";

async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // not JSON
  }
  return t.requestFailed;
}

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        router.replace("/admin");
        return; // keep the button disabled while navigating
      }
      setError(await messageOf(response));
    } catch {
      setError(t.requestFailed);
    }
    setSubmitting(false);
  }

  async function onForgot() {
    if (resetBusy) return;
    setResetBusy(true);
    try {
      await fetch("/api/admin/password-reset/request", { method: "POST" });
    } catch {
      // Same message whatever happens (the API never reveals more).
    }
    setResetMessage(t.resetSent);
    setResetBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{t.username}</span>
          <input
            className={inputClass}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-foreground">{t.password}</span>
          <input
            className={inputClass}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className={buttonClass} disabled={submitting}>
          {submitting ? t.loggingIn : t.login}
        </button>
      </form>
      <button
        type="button"
        className="self-center py-2 text-sm text-muted underline disabled:opacity-50"
        onClick={onForgot}
        disabled={resetBusy}
      >
        {t.forgotPassword}
      </button>
      {resetMessage ? (
        <p role="status" className="text-center text-sm text-foreground">
          {resetMessage}
        </p>
      ) : null}
    </div>
  );
}
