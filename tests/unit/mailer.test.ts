import { afterEach, describe, expect, it, vi } from "vitest";
import { getTransport, MailConfigError, RESEND_ENDPOINT, ResendTransport } from "@/server/mailer";

const KEY = "re_super_secret_key_123";
const msg = {
  to: "owner@example.com",
  from: "Bakery <orders@example.com>",
  subject: "Subject",
  text: "Body",
  idempotencyKey: "new_order:abc",
};

function fakeFetch(res: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => res());
}

describe("ResendTransport", () => {
  it("POSTs the expected request", async () => {
    const f = fakeFetch(() => Response.json({ id: "email_1" }));
    const t = new ResendTransport({ apiKey: KEY, fetch: f });
    expect(await t.send(msg)).toEqual({ id: "email_1" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(RESEND_ENDPOINT).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Idempotency-Key"]).toBe("new_order:abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({
      from: msg.from,
      to: ["owner@example.com"],
      subject: "Subject",
      text: "Body",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("non-2xx throws with status and short body, without the key or recipient", async () => {
    const f = fakeFetch(
      () => new Response(`{"message":"bad key ${KEY} for owner@example.com ${"x".repeat(1000)}"}`, { status: 401 }),
    );
    const t = new ResendTransport({ apiKey: KEY, fetch: f });
    const err = await t.send(msg).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const m = (err as Error).message;
    expect(m).toContain("401");
    expect(m).not.toContain(KEY);
    expect(m).not.toContain("owner@example.com");
    expect(m.length).toBeLessThan(300);
  });

  it("network errors do not leak the key", async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new Error(`connect failed ${KEY}`);
    });
    const err = await new ResendTransport({ apiKey: KEY, fetch: f }).send(msg).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(KEY);
  });

  it("times out via AbortController", async () => {
    const f = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const t = new ResendTransport({ apiKey: KEY, fetch: f, timeoutMs: 30 });
    await expect(t.send(msg)).rejects.toThrow(/timed out after 30 ms/);
  });

  it("uses a 10 s default timeout", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const p = new ResendTransport({ apiKey: KEY, fetch: f }).send(msg).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(f.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(((await p) as Error).message).toMatch(/timed out after 10000 ms/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getTransport", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["RESEND_API_KEY", "MAIL_FROM", "ADMIN_EMAIL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns a transport that fails with a config error when env is missing", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.MAIL_FROM = "a@example.com";
    process.env.ADMIN_EMAIL = "b@example.com";
    const err = await getTransport().send(msg).catch((e: Error) => e);
    expect(err).toBeInstanceOf(MailConfigError);
    expect((err as Error).message).toContain("RESEND_API_KEY");
  });

  it("returns a ResendTransport when configured", () => {
    process.env.RESEND_API_KEY = KEY;
    process.env.MAIL_FROM = "a@example.com";
    process.env.ADMIN_EMAIL = "b@example.com";
    expect(getTransport()).toBeInstanceOf(ResendTransport);
  });
});
