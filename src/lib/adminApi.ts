// Client-side fetch helper for /api/admin/** (JSON in, JSON out). A 401 sends the
// browser to the login page. Never throws: network and parse failures come back as
// `{ ok: false }` too.

import { copy } from "@/copy";

export const ADMIN_LOGIN_PATH = "/admin/login";

export type AdminApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string; [extra: string]: unknown };

export interface AdminApiOptions {
  method?: string;
  /** JSON-serialised when present. */
  body?: unknown;
  signal?: AbortSignal;
}

export async function adminApi<T = unknown>(
  path: string,
  options: AdminApiOptions = {},
): Promise<AdminApiResult<T>> {
  const method = (options.method ?? (options.body === undefined ? "GET" : "POST")).toUpperCase();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    return { ok: false, error: "NETWORK", message: copy.admin.shell.requestFailed };
  }

  if (response.status === 401) {
    // Deliberate full navigation: drops all client state and re-runs the server guards.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (typeof window !== "undefined") window.location.href = ADMIN_LOGIN_PATH;
    return { ok: false, error: "UNAUTHORIZED", message: copy.errors.UNAUTHORIZED };
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // empty or non-JSON body
  }

  if (response.ok) return { ok: true, data: json as T };

  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const { error, message, ...extra } = body;
  return {
    ...extra,
    ok: false,
    error: typeof error === "string" ? error : "INTERNAL",
    message: typeof message === "string" && message ? message : copy.admin.shell.requestFailed,
  };
}
