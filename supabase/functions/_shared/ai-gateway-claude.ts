// Claude Messages API call for ai-gateway.ts (official Anthropic SDK).
// Imported lazily, only when ANTHROPIC_API_KEY is configured.
import Anthropic from "npm:@anthropic-ai/sdk@1.5.0";

let client: Anthropic | null = null;

export type ClaudeResult =
  | { ok: true; message: Anthropic.Beta.BetaMessage }
  | { ok: false; status: number; error: string };

export async function sendClaude(
  params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks">,
  signal?: AbortSignal | null,
): Promise<ClaudeResult> {
  client ??= new Anthropic();
  try {
    const message = await client.beta.messages.create(
      { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
      signal ? { signal } : undefined,
    );
    return { ok: true, message };
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, status: 502, error: "anthropic_connection_error" };
    }
    if (error instanceof Anthropic.APIError && typeof error.status === "number") {
      return { ok: false, status: error.status, error: error.message };
    }
    throw error;
  }
}
