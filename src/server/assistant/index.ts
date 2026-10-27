// POST /api/assistant logic (C3, D117, D118). The route handler stays thin.
//
// Order of checks: body shape → key configured → IP hash → daily limits (counted before the
// upstream call) → model loop (≤ 4 tool rounds, one 20 s deadline for the whole request).
// Nothing the customer typed is stored or logged; it is PII-scrubbed before it leaves.

import { z } from "zod";
import { copy } from "@/copy";
import type { CartLine, Fulfillment } from "@/domain/types";
import { loadAvailabilityInput } from "../availabilityData";
import type { DbClient } from "../db";
import { AppError } from "../errors";
import { getMenu } from "../menu";
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
export const MAX_TOOL_ROUNDS = 4;
/** Tool calls executed per round; extra ones get an error result. */
const MAX_CALLS_PER_ROUND = 6;
export const DEADLINE_MS = 20_000;

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

const UNAVAILABLE = { status: 503, body: { error: "ASSISTANT_UNAVAILABLE" } } as const;

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

  const signal = AbortSignal.timeout(DEADLINE_MS);
  let content = "";
  try {
    for (let round = 0; ; round++) {
      const last = round >= MAX_TOOL_ROUNDS;
      const result = await chatCompletion({
        apiKey,
        baseUrl: env.baseUrl,
        model: env.model,
        messages,
        tools: TOOL_DEFINITIONS,
        toolChoice: last ? "none" : "auto",
        signal,
      });
      if (last || result.toolCalls.length === 0) {
        content = result.content;
        break;
      }
      messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
      result.toolCalls.forEach((call, i) => {
        const output =
          i < MAX_CALLS_PER_ROUND
            ? runTool(ctx, call.function.name, call.function.arguments)
            : { error: "一次调用的工具太多了" };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      });
    }
  } catch (e) {
    if (e instanceof UpstreamError) {
      console.error(`/api/assistant: ${e.reason}`);
      return UNAVAILABLE;
    }
    throw e;
  }

  const reply =
    plainText(content, REPLY_MAX) ||
    (ctx.suggestion ? copy.assistantApi.suggestionReply : copy.assistantApi.emptyReply);
  const body: AssistantReply = { reply, remaining: usage.remaining };
  if (ctx.suggestion) body.suggestion = ctx.suggestion;
  return { status: 200, body };
}
