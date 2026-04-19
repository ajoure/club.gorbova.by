// PATCH 0.1 — Live capture endpoint для ManyChat webhook payloads.
// Назначение: ОДНОРАЗОВО зафиксировать реальные headers + raw body + signature contract.
// Никакой бизнес-логики. Никаких записей в production-таблицы.
// Удаляется вместе с manychat_diagnose_log после завершения PATCH 0.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-manychat-signature, x-mc-signature, x-signature, x-hub-signature, x-hub-signature-256",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SIGNATURE_HEADER_CANDIDATES = [
  "x-manychat-signature",
  "x-mc-signature",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "manychat-signature",
  "x-webhook-signature",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET / health probe — для ручной проверки, что URL живой
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        purpose:
          "ManyChat diagnose capture endpoint (PATCH 0). POST any webhook here — headers + body будут залогированы в manychat_diagnose_log.",
        instruction:
          "Вставь этот URL в ManyChat → Settings → API → Webhooks и спровоцируй: subscriber:created, message:received, subscriber:tagged.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const receivedAt = new Date().toISOString();
  const headersObj: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  // Кандидаты на сигнатурный заголовок — собираем всё, что похоже
  const signatureCandidates: Record<string, string> = {};
  for (const candidate of SIGNATURE_HEADER_CANDIDATES) {
    const v = req.headers.get(candidate);
    if (v) signatureCandidates[candidate] = v;
  }

  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const contentType = req.headers.get("content-type") || null;

  let rawBody = "";
  let parsedBody: unknown = null;
  try {
    rawBody = await req.text();
    if (rawBody && contentType?.includes("json")) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = null;
      }
    }
  } catch (e) {
    rawBody = `<<failed to read body: ${(e as Error).message}>>`;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("manychat_diagnose_log")
    .insert({
      received_at: receivedAt,
      http_method: req.method,
      source_ip: sourceIp,
      headers: headersObj,
      raw_body: rawBody,
      parsed_body: parsedBody,
      content_type: contentType,
      signature_header_candidates: signatureCandidates,
      notes: "PATCH 0 live capture",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[manychat-diagnose-capture] insert error:", error);
    // Возвращаем 200, чтобы ManyChat не запускал retry-цикл во время capture
    return new Response(
      JSON.stringify({ ok: false, captured: false, error: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  console.log("[manychat-diagnose-capture] captured:", data?.id, {
    method: req.method,
    contentType,
    signatureCandidates: Object.keys(signatureCandidates),
    bodyLength: rawBody.length,
  });

  return new Response(
    JSON.stringify({ ok: true, captured: true, log_id: data?.id }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
