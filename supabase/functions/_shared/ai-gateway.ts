// Drop-in replacement for `fetch` on Lovable AI gateway chat completions.
//
// Without ANTHROPIC_API_KEY in the environment this is exactly `fetch`: every
// request keeps going to the Lovable AI gateway as before. With the key set,
// chat-completions requests are translated to the Claude Messages API through
// the official Anthropic SDK and the answer is returned as an OpenAI-shaped
// chat-completions Response, so existing callers keep their parsing and status
// handling. Requests Claude cannot serve (image generation, audio input,
// /audio/transcriptions) are passed through unchanged.
import type Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

export const LOVABLE_CHAT_COMPLETIONS_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
const MIN_MAX_TOKENS = 8000; // adaptive thinking shares max_tokens with the answer
const JSON_ONLY = "Ответь только одним JSON-объектом, без пояснений и без markdown.";

type Json = Record<string, unknown>;
type ChatPart = { type: string; text?: string; image_url?: { url?: string } | string };
type ChatMessage = {
  role: string;
  content?: string | ChatPart[] | null;
  tool_calls?: { id: string; function: { name: string; arguments?: string } }[];
  tool_call_id?: string;
};

export class UnsupportedForClaude extends Error {}

// Structural access keeps this module importable from the app's frontend tests.
function envGet(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env.get(name);
}

export function claudeEnabled(): boolean {
  return Boolean(envGet("ANTHROPIC_API_KEY"));
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function effortFor(model: unknown): "low" | "medium" | "high" {
  const override = envGet("ANTHROPIC_EFFORT");
  if (override === "low" || override === "medium" || override === "high") return override;
  const name = String(model ?? "");
  if (name.includes("lite")) return "low";
  if (name.includes("pro")) return "high";
  return "medium";
}

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url);
  if (match) {
    return { type: "image", source: { type: "base64", media_type: match[1] as "image/png", data: match[2] } };
  }
  if (/^https?:\/\//.test(url)) return { type: "image", source: { type: "url", url } };
  throw new UnsupportedForClaude("unsupported_image_source");
}

function contentBlocks(content: ChatMessage["content"]): Anthropic.ContentBlockParam[] {
  if (content == null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!url) throw new UnsupportedForClaude("empty_image_url");
      blocks.push(imageBlock(url));
    } else {
      throw new UnsupportedForClaude(`unsupported_content_${part.type}`);
    }
  }
  return blocks;
}

function textOf(content: ChatMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
}

/** Translate an OpenAI-style chat-completions body into Messages API params. */
export function toClaudeRequest(body: Json) {
  if (body.stream) throw new UnsupportedForClaude("streaming_not_supported");
  if (body.modalities) throw new UnsupportedForClaude("image_generation_not_supported");

  const system: string[] = [];
  const messages: Anthropic.MessageParam[] = [];
  for (const message of (body.messages as ChatMessage[]) ?? []) {
    if (message.role === "system" || message.role === "developer") {
      system.push(textOf(message.content));
    } else if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: String(message.tool_call_id), content: textOf(message.content) }],
      });
    } else if (message.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = contentBlocks(message.content);
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: call.function.arguments ? JSON.parse(call.function.arguments) : {},
        });
      }
      if (blocks.length) messages.push({ role: "assistant", content: blocks });
    } else {
      const blocks = contentBlocks(message.content);
      if (blocks.length) messages.push({ role: "user", content: blocks });
    }
  }

  const tools = ((body.tools as { function?: { name: string; description?: string; parameters?: Json } }[]) ?? [])
    .filter((tool) => tool.function)
    .map((tool) => ({
      name: tool.function!.name,
      description: tool.function!.description ?? "",
      input_schema: (tool.function!.parameters ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
    }));

  // Claude Opus 5.5 rejects forced tool_choice; steer from the system prompt instead.
  const choice = body.tool_choice as string | { function?: { name?: string } } | undefined;
  let toolChoice: Anthropic.ToolChoice | undefined = tools.length ? { type: "auto" } : undefined;
  if (choice === "none") toolChoice = { type: "none" };
  else if (choice === "required") system.push("Обязательно вызови один из доступных инструментов.");
  else if (typeof choice === "object" && choice?.function?.name) {
    system.push(`Обязательно вызови инструмент ${choice.function.name}.`);
  }

  const format = body.response_format as { type?: string } | undefined;
  if (format?.type === "json_object" || format?.type === "json_schema") system.push(JSON_ONLY);

  const requested = Number(body.max_tokens ?? body.max_completion_tokens ?? 16000);
  return {
    model: envGet("ANTHROPIC_MODEL") || DEFAULT_CLAUDE_MODEL,
    max_tokens: Math.max(Number.isFinite(requested) ? requested : 16000, MIN_MAX_TOKENS),
    ...(system.length ? { system: system.filter(Boolean).join("\n\n") } : {}),
    messages,
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
    output_config: { effort: effortFor(body.model) },
    jsonOnly: Boolean(format?.type),
  };
}

function stripFence(text: string): string {
  const match = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return match ? match[1] : text;
}

const FINISH: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

/** Map a Claude message to an OpenAI chat-completions JSON body. */
export function toChatCompletion(message: Anthropic.Beta.BetaMessage, jsonOnly: boolean): Json {
  let text = "";
  const toolCalls: Json[] = [];
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } });
    }
  }
  if (jsonOnly) text = stripFence(text);
  return {
    id: message.id,
    object: "chat.completion",
    model: message.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: FINISH[message.stop_reason ?? ""] ?? "stop",
    }],
    usage: {
      prompt_tokens: message.usage.input_tokens,
      completion_tokens: message.usage.output_tokens,
      total_tokens: message.usage.input_tokens + message.usage.output_tokens,
    },
  };
}

function jsonResponse(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function claudeChat(body: Json, signal?: AbortSignal | null): Promise<Response> {
  const { jsonOnly, ...params } = toClaudeRequest(body);
  // Loaded lazily so bundlers/tests that never enable Claude do not load the SDK.
  const { sendClaude } = await import("./ai-gateway-claude.ts");
  const result = await sendClaude(params, signal);
  // `in` checks keep the narrowing valid under the app tsconfig (non-strict).
  if ("message" in result) return jsonResponse(200, toChatCompletion(result.message, jsonOnly));
  return jsonResponse("status" in result ? result.status : 502, {
    error: { message: "error" in result ? result.error : "anthropic_error", provider: "anthropic" },
  });
}

/** `fetch` that routes Lovable chat completions to Claude when ANTHROPIC_API_KEY is set. */
export async function aiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!claudeEnabled() || requestUrl(input) !== LOVABLE_CHAT_COMPLETIONS_URL || typeof init?.body !== "string") {
    return fetch(input, init);
  }
  let body: Json;
  try {
    body = JSON.parse(init.body);
  } catch {
    return fetch(input, init);
  }
  try {
    return await claudeChat(body, init.signal);
  } catch (error) {
    if (error instanceof UnsupportedForClaude) return fetch(input, init);
    throw error;
  }
}
