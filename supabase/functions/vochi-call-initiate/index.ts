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
// Тело запроса: { phone: E164, contact_id?: uuid, company_id?: uuid, deal_id?: uuid }
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
  const companyId: string | null = body?.company_id ?? null;
  const dealId: string | null = body?.deal_id ?? null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (companyId) {
    const { data: company, error: companyErr } = await admin
      .from("companies")
      .select("id, status")
      .eq("id", companyId)
      .maybeSingle();
    if (companyErr) return json(500, { error: "company_lookup_failed" });
    if (!company || company.status !== "active") return json(404, { error: "company_not_found" });
  }

  // ── 3. Право на исходящие звонки ─────────────────────────────────────────
  // SOT — матрица доступа: роль пользователя должна иметь access_level
  // 'manage' (или будущий 'write'/'full') на секцию 'calls'. Так совпадает
  // с тем, что админ настраивает в «Сотрудники и роли → Доступ → Звонки и SMS».
  const { data: sectionRows, error: sectionErr } = await admin
    .from("user_roles_v2")
    .select(
      "role_admin_section_access:role_id!inner(access_level, section:admin_section!inner(code))",
    )
    .eq("user_id", userId);
  if (sectionErr) {
    // На случай нюансов FK-join — фолбэк двумя запросами.
    const { data: roleRows } = await admin
      .from("user_roles_v2")
      .select("role_id")
      .eq("user_id", userId);
    const roleIds = (roleRows ?? []).map((r: any) => r.role_id).filter(Boolean);
    let hasCallsAccess = false;
    if (roleIds.length) {
      const { data: secId } = await admin
        .from("admin_section")
        .select("id")
        .eq("code", "calls")
        .maybeSingle();
      if (secId?.id) {
        const { data: acc } = await admin
          .from("role_admin_section_access")
          .select("access_level")
          .in("role_id", roleIds)
          .eq("section_id", secId.id);
        hasCallsAccess = (acc ?? []).some((a: any) =>
          ["manage", "write", "full"].includes(String(a.access_level)),
        );
      }
    }
    if (!hasCallsAccess) {
      // Доп. проверка: глобальные admin/super_admin всегда могут.
      const roleChecks = await Promise.all(
        (["admin", "super_admin"] as const).map((r) =>
          admin.rpc("has_role_v2", { _user_id: userId, _role_code: r }),
        ),
      );
      if (!roleChecks.some((r) => r.data === true)) {
        return json(403, { error: "not_staff" });
      }
    }
  } else {
    const allowed = (sectionRows ?? []).some((row: any) => {
      const list = Array.isArray(row.role_admin_section_access)
        ? row.role_admin_section_access
        : [row.role_admin_section_access].filter(Boolean);
      return list.some(
        (r: any) =>
          r?.section?.code === "calls" &&
          ["manage", "write", "full"].includes(String(r?.access_level)),
      );
    });
    if (!allowed) {
      const roleChecks = await Promise.all(
        (["admin", "super_admin"] as const).map((r) =>
          admin.rpc("has_role_v2", { _user_id: userId, _role_code: r }),
        ),
      );
      if (!roleChecks.some((r) => r.data === true)) {
        return json(403, { error: "not_staff" });
      }
    }
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
      external_call_id: `pending:${crypto.randomUUID()}`,
      direction: "outbound",
      status: "queued",
      link_status: contactId ? "manual" : "unresolved",
      phone_to_e164: phone,
      contact_id: contactId,
      company_id: companyId,
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
  const redactedUrl = url.replace(
    /clientId=[^&]+/,
    `clientId=${String(clientId).slice(0, 4)}***`,
  );
  const reqMeta = {
    base_url: baseUrl,
    path: "/api/makecallexternal",
    code: ext,
    phone,
    client_id_prefix: String(clientId).slice(0, 4),
    client_id_len: String(clientId).length,
    url_redacted: redactedUrl,
    sent_at: new Date().toISOString(),
  };
  console.log("vochi-call-initiate request", JSON.stringify(reqMeta));

  const startedFetch = Date.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const text = await resp.text();
    const latencyMs = Date.now() - startedFetch;
    const respMeta = {
      http_status: resp.status,
      latency_ms: latencyMs,
      content_type: resp.headers.get("content-type"),
      body_snippet: text.slice(0, 1000),
    };
    console.log("vochi-call-initiate response", JSON.stringify(respMeta));

    if (!resp.ok) {
      await admin
        .from("calls")
        .update({
          status: "failed",
          metadata: {
            sip_extension: ext,
            initiated_via: "vochi-call-initiate",
            vochi_request: reqMeta,
            vochi_response: respMeta,
          },
        })
        .eq("id", callRow.id);
      return json(502, {
        error: "vochi_api_error",
        http_status: resp.status,
        body_snippet: text.slice(0, 500),
        call_id: callRow.id,
      });
    }

    await admin
      .from("calls")
      .update({
        metadata: {
          sip_extension: ext,
          initiated_via: "vochi-call-initiate",
          vochi_request: reqMeta,
          vochi_response: respMeta,
        },
      })
      .eq("id", callRow.id);

    return json(200, {
      call_id: callRow.id,
      public_id: callRow.public_id,
      status: "queued",
      vochi_http_status: resp.status,
      vochi_body_snippet: text.slice(0, 500),
    });
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);
    console.error("vochi-call-initiate fetch_failed", errMsg);
    await admin
      .from("calls")
      .update({
        status: "failed",
        metadata: {
          sip_extension: ext,
          initiated_via: "vochi-call-initiate",
          vochi_request: reqMeta,
          fetch_error: errMsg,
        },
      })
      .eq("id", callRow.id);
    return json(502, { error: "vochi_fetch_failed", detail: errMsg, call_id: callRow.id });
  }
});
