// Minimal DeepSeek client (OpenAI-compatible chat completions, non-streaming) over fetch.
// No SDK, no new dependency. Errors are reported by HTTP status only: request and response
// bodies (customer text) are never logged.

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export class UpstreamError extends Error {
  constructor(readonly reason: string) {
    super(`assistant upstream: ${reason}`);
    this.name = "UpstreamError";
  }
}

export interface ChatRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools: readonly unknown[];
  toolChoice: "auto" | "none";
  /** Abort the call after this long (setTimeout, so it can be driven by fake timers in tests). */
  timeoutMs: number;
}

export const MAX_TOKENS = 250;

function isToolCall(x: unknown): x is ToolCall {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  const f = c.function as Record<string, unknown> | undefined;
  return typeof c.id === "string" && !!f && typeof f.name === "string" && typeof f.arguments === "string";
}

export async function chatCompletion(req: ChatRequest): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, req.timeoutMs));
  try {
    return await send(req, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function send(req: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(`${req.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        tools: req.tools,
        tool_choice: req.toolChoice,
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
      signal,
    });
  } catch (e) {
    throw new UpstreamError(signal.aborted ? "timeout" : `network ${(e as Error)?.name ?? "error"}`);
  }
  // 402 = DeepSeek balance exhausted; 401 bad key; 429/5xx overloaded.
  if (!res.ok) throw new UpstreamError(`status ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamError(signal.aborted ? "timeout" : "bad json");
  }
  const message = (body as { choices?: { message?: Record<string, unknown> }[] })?.choices?.[0]?.message;
  if (!message) throw new UpstreamError("no choices");
  const content = typeof message.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isToolCall) : [];
  return { content, toolCalls };
}
