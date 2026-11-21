import { aiFetch, toChatCompletion, toClaudeRequest, UnsupportedForClaude } from "./ai-gateway.ts";

function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

Deno.test("system, images, json and effort are translated", () => {
  const request = toClaudeRequest({
    model: "google/gemini-2.5-flash-lite",
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "S1" },
      { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] },
    ],
  });
  eq(request.max_tokens, 8000, "max_tokens floor");
  eq(request.output_config, { effort: "low" }, "effort");
  eq(request.jsonOnly, true, "json flag");
  eq((request as Record<string, unknown>).temperature, undefined, "temperature dropped");
  if (!String(request.system).startsWith("S1")) throw new Error("system");
  eq(request.messages[0].content, [
    { type: "text", text: "hi" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
  ], "user blocks");
});

Deno.test("tool calls and forced tool choice", () => {
  const request = toClaudeRequest({
    tools: [{ type: "function", function: { name: "analyze", description: "d", parameters: { type: "object", properties: {} } } }],
    tool_choice: { type: "function", function: { name: "analyze" } },
    messages: [
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", function: { name: "analyze", arguments: "{\"a\":1}" } }] },
      { role: "tool", tool_call_id: "t1", content: "result" },
    ],
  });
  eq(request.tool_choice, { type: "auto" }, "no forced choice");
  if (!String(request.system).includes("analyze")) throw new Error("forced tool steered by system");
  eq(request.messages[1].content, [{ type: "tool_use", id: "t1", name: "analyze", input: { a: 1 } }], "tool_use");
  eq(request.messages[2].content, [{ type: "tool_result", tool_use_id: "t1", content: "result" }], "tool_result");
});

Deno.test("unsupported requests are refused for Claude", () => {
  for (const body of [
    { stream: true, messages: [] },
    { modalities: ["image", "text"], messages: [] },
    { messages: [{ role: "user", content: [{ type: "input_audio" }] }] },
  ]) {
    try {
      toClaudeRequest(body);
      throw new Error("accepted");
    } catch (error) {
      if (!(error instanceof UnsupportedForClaude)) throw error;
    }
  }
});

Deno.test("Claude message maps to chat completion", () => {
  const out = toChatCompletion({
    id: "msg_1", model: "claude-opus-5-5", stop_reason: "tool_use",
    content: [
      { type: "text", text: "```json\n{\"ok\":true}\n```" },
      { type: "tool_use", id: "t1", name: "analyze", input: { a: 1 } },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  } as never, true) as { choices: { message: { content: string; tool_calls: unknown[] }; finish_reason: string }[] };
  eq(out.choices[0].message.content, "{\"ok\":true}", "fence stripped");
  eq(out.choices[0].finish_reason, "tool_calls", "finish");
  eq(out.choices[0].message.tool_calls, [{ id: "t1", type: "function", function: { name: "analyze", arguments: "{\"a\":1}" } }], "tool_calls");
});

Deno.test("without ANTHROPIC_API_KEY aiFetch is plain fetch", async () => {
  Deno.env.delete("ANTHROPIC_API_KEY");
  const original = globalThis.fetch;
  let seen = "";
  globalThis.fetch = ((input: string) => { seen = input; return Promise.resolve(new Response("ok")); }) as typeof fetch;
  try {
    await aiFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { method: "POST", body: "{}" });
    eq(seen, "https://ai.gateway.lovable.dev/v1/chat/completions", "passthrough");
  } finally {
    globalThis.fetch = original;
  }
});
