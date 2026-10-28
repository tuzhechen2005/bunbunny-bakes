// POST /api/assistant logic (C3, D117, D118). The route handler stays thin.
//
// Order of checks: body shape → key configured → IP hash → daily limits (counted before the
// upstream call) → model loop (≤ 3 model calls = ≤ 2 tool rounds + a forced-text call).
//
// Time budget: Netlify kills a function at 10 s, so the whole request — DB reads included —
// gets BUDGET_MS from its arrival. Each model call gets min(remaining, PER_CALL_MS); a call is
// never started with less than MIN_CALL_MS left. Out of time / upstream failure: the
// validated suggestion if there already is one (200 + a fixed reply), else 503.
// Nothing the customer typed is stored or logged; it is PII-scrubbed before it leaves.

import { z } from "zod";
import { copy } from "@/copy";
import type { CartLine, Fulfillment } from "@/domain/types";
import { loadAvailabilityInput } from "../availabilityData";
import type { DbClient } from "../db";
import { AppError } from "../errors";
import { clientIp } from "../http";
import { getMenu } from "../menu";
import { hashIp } from "../tokens";
import { mergeLines } from "../orders";
import { issuesToFields, MAX_LINES, MAX_QTY_SCHEMA } from "../orderSchemas";
import { chatCompletion, UpstreamError, type ChatMessage } from "./deepseek";
import { systemPrompt } from "./prompt";
import { scrubPii } from "./scrub";
import { plainText } from "./text";
import { runTool, TOOL_DEFINITIONS, type Suggestion, type ToolContext } from "./tools";
import { takeMessage } from "./usage";

export const MAX_MESSAGES = 12;
export const MESSAGE_MAX = 500;
export const REPLY_MAX = 400;
/** Model calls per request: up to 2 with tools, the last one is forced to answer in text. */
export const MAX_MODEL_CALLS = 3;
/** Tool calls executed per round; extra ones get an error result. */
export const MAX_CALLS_PER_ROUND = 6;
/** Whole request, from arrival (Netlify's limit is 10 s). */
export const BUDGET_MS = 8_500;
export const PER_CALL_MS = 4_500;
/** Don't start a model call with less time than this left. */
export const MIN_CALL_MS = 1_500;

const codePoints = (s: string) => [...s].length;

export const AssistantBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z
          .string()
          .refine((s) => s.trim().length > 0, { message: "Empty" })
          .refine((s) => codePoints(s) <= MESSAGE_MAX, { message: `At most ${MESSAGE_MAX} characters` }),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES)
    .refine((m) => m[m.length - 1]?.role === "user", { message: "Last message must be from the user" }),
  cart: z
    .array(z.object({ productId: z.uuid(), qty: z.number().int().min(1).max(MAX_QTY_SCHEMA) }))
    .max(MAX_LINES),
  fulfillment: z.enum(["PICKUP", "DELIVERY"]).optional(),
});
export type AssistantRequest = z.infer<typeof AssistantBody>;

export interface AssistantReply {
  reply: string;
  suggestion?: Suggestion;
  remaining: number;
}

export type AssistantOutcome =
  | { status: 200; body: AssistantReply }
  | { status: 429; body: { error: "ASSISTANT_LIMIT" } }
  | { status: 503; body: { error: "ASSISTANT_UNAVAILABLE" } };

export interface AssistantEnv {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

export function assistantEnv(env: NodeJS.ProcessEnv = process.env): AssistantEnv {
  return {
    apiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    model: env.ASSISTANT_MODEL?.trim() || "deepseek-chat",
  };
}

export function parseAssistantBody(raw: unknown): AssistantRequest {
  const r = AssistantBody.safeParse(raw);
  if (!r.success) throw new AppError("VALIDATION", { extra: { fields: issuesToFields(r.error) } });
  return r.data;
}

/** IP hash for the daily limit; null (→ 503, nothing counted) when IP_HASH_SECRET is missing. */
export function assistantIpHash(request: Request): string | null {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) {
    console.error("/api/assistant: IP_HASH_SECRET is not set; refusing");
    return null;
  }
  return hashIp(clientIp(request), secret);
}

const UNAVAILABLE ={ status: 503, body: { error: "ASSISTANT_UNAVAILABLE" } } as const;

export async function askAssistant(
  db: DbClient,
  req: AssistantRequest,
  ipHash: string | null,
  now: Date,
  env: AssistantEnv = assistantEnv(),
): Promise<AssistantOutcome> {
  const apiKey = env.apiKey;
  if (!apiKey || !ipHash) return UNAVAILABLE;

  const usage = await takeMessage(db, ipHash, now);
  if (!usage.allowed) return { status: 429, body: { error: "ASSISTANT_LIMIT" } };

  const cart: CartLine[] = mergeLines(req.cart);
  const fulfillment: Fulfillment = req.fulfillment ?? "PICKUP";
  const [menu, availability] = await Promise.all([
    getMenu(db),
    loadAvailabilityInput(db, { cart: [], fulfillment, now }),
  ]);
  const ctx: ToolContext = { menu, availability, fulfillment };

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt({ menu, cutoffTime: availability.cutoffTime, now, cart, fulfillment: req.fulfillment }),
    },
    ...req.messages.map((m) => ({ role: m.role, content: scrubPii(m.content) }) as ChatMessage),
  ];

  const deadline = now.getTime() + BUDGET_MS;
  const giveUp = (reason: string): AssistantOutcome => {
    console.error(`/api/assistant: ${reason}`);
    // A validated card already exists: it is the useful part, the customer paid a message for it.
    if (ctx.suggestion) {
      return {
        status: 200,
        body: { reply: copy.assistantApi.suggestionReply, suggestion: ctx.suggestion, remaining: usage.remaining },
      };
    }
    return UNAVAILABLE;
  };

  let content = "";
  for (let call = 0; ; call++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_CALL_MS) return giveUp("out of time");
    const last = call >= MAX_MODEL_CALLS - 1;
    let result;
    try {
      result = await chatCompletion({
        apiKey,
        baseUrl: env.baseUrl,
        model: env.model,
        messages,
        tools: TOOL_DEFINITIONS,
        toolChoice: last ? "none" : "auto",
        timeoutMs: Math.min(remaining, PER_CALL_MS),
      });
    } catch (e) {
      if (e instanceof UpstreamError) return giveUp(e.reason);
      throw e;
    }
    if (last || result.toolCalls.length === 0) {
      content = result.content;
      break;
    }
    messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
    result.toolCalls.forEach((tc, i) => {
      const output =
        i < MAX_CALLS_PER_ROUND
          ? runTool(ctx, tc.function.name, tc.function.arguments)
          : { error: "一次调用的工具太多了" };
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(output) });
    });
  }

  const reply =
    plainText(content, REPLY_MAX) ||
    (ctx.suggestion ? copy.assistantApi.suggestionReply : copy.assistantApi.emptyReply);
  const body: AssistantReply = { reply, remaining: usage.remaining };
  if (ctx.suggestion) body.suggestion = ctx.suggestion;
  return { status: 200, body };
}
