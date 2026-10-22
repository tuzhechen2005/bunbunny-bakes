// Email transport for the outbox (docs/NOTIFICATIONS.md §1). Resend over plain fetch,
// no SDK. Never logs or reports the API key or the recipient address.

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  /** Sent as `Idempotency-Key`; the notification's dedupeKey. */
  idempotencyKey: string;
}

export interface MailTransport {
  /** `duplicate`: the provider says this idempotency key was already accepted. */
  send(msg: MailMessage): Promise<{ id: string; duplicate?: boolean }>;
}

function resendErrorName(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;
const MAX_BODY_IN_ERROR = 200;

export interface ResendTransportOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Replaces every occurrence of each secret in `text` with `[redacted]`. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 3) {
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "gi"), "[redacted]");
    }
  }
  return out;
}

export class ResendTransport implements MailTransport {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ResendTransportOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;
  }

  async send(msg: MailMessage): Promise<{ id: string; duplicate?: boolean }> {
    if (!msg.to || !msg.from) throw new MailConfigError("mail recipient or sender is not configured");
    const secrets = [this.apiKey, msg.to];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": msg.idempotencyKey,
          },
          body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text }),
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) {
          throw new Error(`Resend request timed out after ${this.timeoutMs} ms`);
        }
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(redact(`Resend request failed: ${reason}`, secrets));
      }
      const body = await res.text().catch(() => "");
      // Same Idempotency-Key with a different body: a retry of an email Resend already
      // accepted (the body was re-rendered after the data changed). Treat it as sent.
      if (res.status === 409 && resendErrorName(body) === "invalid_idempotent_request") {
        return { id: "", duplicate: true };
      }
      if (!res.ok) {
        const short = body.replace(/\s+/g, " ").slice(0, MAX_BODY_IN_ERROR);
        throw new Error(redact(`Resend responded ${res.status}: ${short}`, secrets));
      }
      let id = "";
      try {
        const parsed = JSON.parse(body) as { id?: unknown };
        if (typeof parsed.id === "string") id = parsed.id;
      } catch {
        // A 2xx without a JSON body still means accepted.
      }
      return { id };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

/** A transport that always fails: counts as a normal send failure, so it is retried. */
class UnconfiguredTransport implements MailTransport {
  constructor(private readonly missing: string[]) {}
  async send(): Promise<{ id: string }> {
    throw new MailConfigError(`mail is not configured: missing ${this.missing.join(", ")}`);
  }
}

/** Sender and recipient for owner notifications (env); empty when unset. */
export function ownerAddresses(): { from: string; to: string } {
  return { from: process.env.MAIL_FROM ?? "", to: process.env.ADMIN_EMAIL ?? "" };
}

/** Values that must never appear in logs or `Notification.lastError`. */
export function mailSecrets(): (string | undefined)[] {
  return [process.env.RESEND_API_KEY, process.env.ADMIN_EMAIL];
}

/** The transport from env (RESEND_API_KEY, MAIL_FROM, ADMIN_EMAIL). */
export function getTransport(): MailTransport {
  const missing = ["RESEND_API_KEY", "MAIL_FROM", "ADMIN_EMAIL"].filter((k) => !process.env[k]);
  if (missing.length > 0) return new UnconfiguredTransport(missing);
  return new ResendTransport({ apiKey: process.env.RESEND_API_KEY as string });
}
