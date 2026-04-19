// PATCH 0 — Diagnose endpoint для ManyChat.
// Два режима:
//   1) POST с ManyChat webhook payload → логирует headers + body в manychat_diagnose_log
//   2) POST {"action":"probe"} с auth (super_admin) → дёргает реальные ManyChat API endpoints
//      и собирает capability matrix аккаунта (rate limits, available features).
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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MANYCHAT_TEST_API_KEY = Deno.env.get("MANYCHAT_TEST_API_KEY") || "";

const SIGNATURE_HEADER_CANDIDATES = [
  "x-manychat-signature",
  "x-mc-signature",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "manychat-signature",
  "x-webhook-signature",
];

const MANYCHAT_BASE = "https://api.manychat.com";

async function callManychat(path: string): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${MANYCHAT_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MANYCHAT_TEST_API_KEY}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const rateHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase().includes("rate") || k.toLowerCase().includes("limit")) {
        rateHeaders[k] = v;
      }
    });
    return {
      path,
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - startedAt,
      rate_headers: rateHeaders,
      body_preview: text.slice(0, 1500),
      body_json: json,
    };
  } catch (e) {
    return {
      path,
      ok: false,
      error: (e as Error).message,
      latency_ms: Date.now() - startedAt,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Health probe (GET) ---
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        purpose:
          "ManyChat diagnose capture endpoint (PATCH 0). POST any webhook here to log it. POST {action:'probe'} as super_admin to run capability matrix probe.",
        webhook_url:
          `${SUPABASE_URL}/functions/v1/manychat-diagnose-capture`,
        api_key_configured: MANYCHAT_TEST_API_KEY.length > 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const contentType = req.headers.get("content-type") || "";
  let rawBody = "";
  let parsedBody: unknown = null;
  try {
    rawBody = await req.text();
    if (rawBody && contentType.includes("json")) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = null;
      }
    }
  } catch (e) {
    rawBody = `<<failed: ${(e as Error).message}>>`;
  }

  // --- API probe mode (требует super_admin) ---
  if (
    parsedBody && typeof parsedBody === "object" &&
    (parsedBody as Record<string, unknown>).action === "probe"
  ) {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "auth required for probe" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { data: roleCheck } = await svc.rpc("has_role", {
      _user_id: claims.claims.sub,
      _role: "superadmin",
    });
    if (!roleCheck) {
      return new Response(
        JSON.stringify({ ok: false, error: "superadmin required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!MANYCHAT_TEST_API_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MANYCHAT_TEST_API_KEY secret not set",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ManyChat API probes — собираем capability matrix
    const probes = await Promise.all([
      callManychat("/fb/page/getInfo"),
      callManychat("/fb/page/getTags"),
      callManychat("/fb/page/getCustomFields"),
      callManychat("/fb/page/getBotFields"),
      callManychat("/fb/page/getGrowthTools"),
      callManychat("/fb/page/getOtnTopics"),
      callManychat("/fb/page/getWidgets"),
      callManychat("/fb/page/getFlows"),
    ]);

    return new Response(
      JSON.stringify(
        { ok: true, probed_at: new Date().toISOString(), probes },
        null,
        2,
      ),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // --- Live capture mode (default) ---
  const receivedAt = new Date().toISOString();
  const headersObj: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  const signatureCandidates: Record<string, string> = {};
  for (const candidate of SIGNATURE_HEADER_CANDIDATES) {
    const v = req.headers.get(candidate);
    if (v) signatureCandidates[candidate] = v;
  }

  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || null;

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
      content_type: contentType || null,
      signature_header_candidates: signatureCandidates,
      notes: "PATCH 0 live capture",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[manychat-diagnose-capture] insert error:", error);
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
