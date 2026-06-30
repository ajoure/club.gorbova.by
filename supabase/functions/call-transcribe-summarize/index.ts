// ============================================================================
// call-transcribe-summarize
// ----------------------------------------------------------------------------
// Расшифровывает запись разговора и формирует краткое резюме через Lovable AI
// Gateway (Gemini, поддержка аудио). Сохраняет transcript, summary, статус.
// Auth: требуется валидный JWT (verify_jwt=true по умолчанию).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // audio in -> text out

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchRecordingBase64(url: string, vochiToken?: string | null) {
  // Если ссылка ведёт на VOCHI API — добавим ?key=<token> для авторизации.
  let finalUrl = url;
  if (vochiToken && /vochi\.by/i.test(url) && !/[?&]key=/i.test(url)) {
    finalUrl = `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(vochiToken)}`;
  }
  const res = await fetch(finalUrl);
  if (!res.ok) {
    throw new Error(`recording_fetch_failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  // base64 chunked encode
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  const base64 = btoa(binary);
  return { base64, contentType };
}

function audioFormatFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("flac")) return "flac";
  return "mp3";
}

async function callGateway(messages: any[]): Promise<string> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  if (res.status === 429) throw new Error("ai_rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ai_gateway_${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return jsonResponse({ error: "missing_lovable_api_key" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const callId = body?.call_id as string | undefined;
    if (!callId) return jsonResponse({ error: "missing_call_id" }, 400);

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: call, error: callErr } = await service
      .from("calls")
      .select("id, workspace_id, recording_url, transcript, summary, transcript_status, duration_seconds")
      .eq("id", callId)
      .maybeSingle();
    if (callErr || !call) return jsonResponse({ error: "call_not_found" }, 404);
    if (!call.recording_url) return jsonResponse({ error: "no_recording" }, 400);

    // mark processing
    await service.from("calls").update({
      transcript_status: "processing",
      transcript_error: null,
    }).eq("id", callId);

    // resolve VOCHI api token (для скачивания записи)
    let vochiToken: string | null = null;
    const { data: cred } = await service
      .from("integration_credentials")
      .select("data")
      .eq("workspace_id", call.workspace_id)
      .eq("provider", "vochi")
      .limit(1)
      .maybeSingle();
    if (cred?.data && typeof cred.data === "object") {
      vochiToken = (cred.data as any).api_token ?? null;
    }

    const { base64, contentType } = await fetchRecordingBase64(call.recording_url, vochiToken);
    const format = audioFormatFromMime(contentType);

    // 1) Транскрипт
    const transcript = await callGateway([
      {
        role: "system",
        content:
          "Ты — точный транскрибатор телефонных разговоров на русском языке. Верни только дословный текст разговора с разметкой по ролям (Оператор:/Клиент:) если можно определить. Не добавляй комментариев.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Расшифруй этот телефонный разговор полностью." },
          { type: "input_audio", input_audio: { data: base64, format } },
        ],
      },
    ]);

    // 2) Сводка по транскрипту
    const summary = await callGateway([
      {
        role: "system",
        content:
          "Ты — ассистент CRM. По расшифровке звонка составь краткое резюме (3-6 строк) на русском: тема, договорённости, следующий шаг. Без приветствий, без лишнего.",
      },
      { role: "user", content: `Расшифровка звонка:\n\n${transcript}` },
    ]);

    await service.from("calls").update({
      transcript: transcript.trim(),
      summary: summary.trim(),
      transcript_status: "done",
      transcribed_at: new Date().toISOString(),
      transcript_error: null,
    }).eq("id", callId);

    return jsonResponse({ ok: true, transcript, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[call-transcribe-summarize] error:", msg);
    try {
      const body = await req.clone().json().catch(() => ({}));
      const callId = body?.call_id;
      if (callId) {
        const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await service.from("calls").update({
          transcript_status: "error",
          transcript_error: msg.slice(0, 500),
        }).eq("id", callId);
      }
    } catch {}
    return jsonResponse({ error: msg }, 500);
  }
});
