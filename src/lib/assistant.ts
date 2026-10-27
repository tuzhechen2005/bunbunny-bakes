// Client for POST /api/assistant (docs/API_SPEC.md, contract C3). Never throws.

import type { Fulfillment } from "./api";
import type { CartItem } from "./cart";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantSuggestion {
  items: CartItem[];
  date: string | null;
  note: string;
}

export interface AssistantRequest {
  messages: AssistantMessage[];
  cart: CartItem[];
  fulfillment?: Fulfillment;
}

export interface AssistantReply {
  reply: string;
  suggestion?: AssistantSuggestion;
  remaining: number;
}

export type AssistantResult =
  | { ok: true; data: AssistantReply }
  | { ok: false; kind: "limit" | "unavailable" };

export const ASSISTANT_MAX_MESSAGES = 12;
export const ASSISTANT_MAX_CHARS = 500;

/** The backend may take up to ~9 s; past this the customer is told 「暂时不在」. */
export const ASSISTANT_TIMEOUT_MS = 12000;

export async function askAssistant(body: AssistantRequest): Promise<AssistantResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, messages: body.messages.slice(-ASSISTANT_MAX_MESSAGES) }),
      cache: "no-store",
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      // not JSON
    }
    const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
    if (response.status === 429 || obj.error === "ASSISTANT_LIMIT") return { ok: false, kind: "limit" };
    if (!response.ok || typeof obj.reply !== "string") return { ok: false, kind: "unavailable" };
    return { ok: true, data: obj as unknown as AssistantReply };
  } catch {
    return { ok: false, kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
