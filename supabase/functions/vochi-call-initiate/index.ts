// ============================================================================
// vochi-call-initiate
// ----------------------------------------------------------------------------
// Phase 3 — серверная инициация исходящего звонка через VOCHI API.
// Контракт VOCHI (из админ-панели):
//   GET {base_url}/api/makecallexternal?code={ext}&phone={e164}&clientId={secret}
//
// Проверки (все на сервере):
//   1. JWT валиден (без verify_jwt в config.toml — валидируем здесь).
//   2. Пользователь имеет роль сотрудника (has_role_v2 staff).
//   3. У пользователя в profiles.vochi_sip_extension задан внутренний номер.
//   4. integrations.is_enabled=true для provider='vochi'; integration_credentials
//      хранит только секреты/config подключения (никакого второго enabled-флага).
//   5. Идемпотентность: тот же (user, phone) в течение IDEMPOTENCY_WINDOW_SEC
//      возвращает существующий call_id вместо нового запроса.
//
// Тело запроса: { phone: E164, contact_id?: uuid, deal_id?: uuid }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IDEMPOTENCY_WINDOW_SEC = 15;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(input: string): string | null {
  const digits = String(input ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  // Превращаем 8XXXXXXXXXX → +7XXXXXXXXXX (РБ/РФ — лучше оставлять +)
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  // ── 1. JWT ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "missing_auth" });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "invalid_jwt" });
  }
  const userId = userData.user.id;

  // ── 2. Тело ──────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const phoneRaw = String(body?.phone ?? "");
  const phone = normalizePhone(phoneRaw);
  if (!phone) return json(400, { error: "invalid_phone" });
  const contactId: string | null = body?.contact_id ?? null;
  const dealId: string | null = body?.deal_id ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 3. Роль сотрудника (staff | admin | super_admin) ─────────────────────
  const roleChecks = await Promise.all(
    (["staff", "admin", "super_admin"] as const).map((r) =>
      admin.rpc("has_role_v2", { _user_id: userId, _role_code: r }),
    ),
  );
  const isStaff = roleChecks.some((r) => r.data === true);
  if (!isStaff) {
    return json(403, { error: "not_staff" });
  }

  // ── 4. Profile.vochi_sip_extension ───────────────────────────────────────
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("vochi_sip_extension")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("profile_lookup_failed", profileErr);
    return json(500, { error: "profile_lookup_failed", detail: profileErr.message });
  }
  const ext = profile?.vochi_sip_extension?.trim();
  if (!ext) return json(412, { error: "sip_extension_missing" });

  // ── 5a. Integration enabled flag — SOT: public.integrations.is_enabled ───
  const { data: integ, error: integErr } = await admin
    .from("integrations")
    .select("is_enabled")
    .eq("provider", "vochi")
    .maybeSingle();
  if (integErr) return json(500, { error: "integration_lookup_failed" });
  if (!integ) return json(412, { error: "integration_not_configured" });
  if (!integ.is_enabled) return json(412, { error: "integration_disabled" });

  // ── 5b. Credentials — только секреты/конфиг подключения ─────────────────
  const { data: cred, error: credErr } = await admin
    .from("integration_credentials")
    .select("config, secrets, status")
    .eq("provider", "vochi")
    .maybeSingle();
  if (credErr) return json(500, { error: "cred_lookup_failed" });
  if (!cred) return json(412, { error: "integration_not_configured" });
  const baseUrl = String(cred.config?.base_url ?? "https://bot.vochi.by").replace(
    /\/+$/,
    "",
  );
  const clientId = cred.secrets?.client_id;
  if (!clientId) return json(412, { error: "client_id_missing" });

  // ── 6. Идемпотентность ───────────────────────────────────────────────────
  const sinceIso = new Date(
    Date.now() - IDEMPOTENCY_WINDOW_SEC * 1000,
  ).toISOString();
  const phoneDigits = phone.replace(/\D/g, "");
  const { data: existing } = await admin
    .from("calls")
    .select("id, public_id, status")
    .eq("created_by", userId)
    .eq("direction", "outbound")
    .gte("created_at", sinceIso)
    .or(
      `phone_to_e164.eq.${phone},phone_to_e164.eq.+${phoneDigits}`,
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return json(200, {
      call_id: existing.id,
      public_id: existing.public_id,
      status: existing.status,
      idempotent: true,
    });
  }

  // ── 7. Pre-create calls row ──────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  const { data: callRow, error: insertErr } = await admin
    .from("calls")
    .insert({
      direction: "outbound",
      status: "queued",
      link_status: contactId ? "manual" : "unresolved",
      phone_to_e164: phone,
      contact_id: contactId,
      deal_id: dealId,
      started_at: startedAt,
      created_by: userId,
      workspace_id: profile?.workspace_id ?? null,
      metadata: { sip_extension: ext, initiated_via: "vochi-call-initiate" },
    })
    .select("id, public_id")
    .single();
  if (insertErr || !callRow) {
    return json(500, {
      error: "call_insert_failed",
      detail: insertErr?.message,
    });
  }

  // ── 8. Вызов VOCHI API ───────────────────────────────────────────────────
  const url =
    `${baseUrl}/api/makecallexternal?code=${encodeURIComponent(ext)}` +
    `&phone=${encodeURIComponent(phone)}&clientId=${encodeURIComponent(clientId)}`;

  try {
    const resp = await fetch(url, { method: "GET" });
    const text = await resp.text();
    if (!resp.ok) {
      await admin
        .from("calls")
        .update({
          status: "failed",
          meta: {
            sip_extension: ext,
            initiated_via: "vochi-call-initiate",
            vochi_http_status: resp.status,
            vochi_response: text.slice(0, 500),
          },
        })
        .eq("id", callRow.id);
      return json(502, {
        error: "vochi_api_error",
        http_status: resp.status,
        call_id: callRow.id,
      });
    }
    return json(200, {
      call_id: callRow.id,
      public_id: callRow.public_id,
      status: "queued",
    });
  } catch (e: any) {
    await admin
      .from("calls")
      .update({
        status: "failed",
        meta: {
          sip_extension: ext,
          initiated_via: "vochi-call-initiate",
          fetch_error: String(e?.message ?? e),
        },
      })
      .eq("id", callRow.id);
    return json(502, { error: "vochi_fetch_failed", call_id: callRow.id });
  }
});
