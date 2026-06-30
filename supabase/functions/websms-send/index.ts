// ============================================================================
// websms-send (SMS.by provider)
// ----------------------------------------------------------------------------
// Отправка SMS через SMS.by (app.sms.by/api/v1).
//
// Контракт SMS.by:
//   GET https://app.sms.by/api/v1/sendQuickSMS?token=<token>
//       &message=<text>&phone=<msisdn>[&alphaname_id=<id>]
//   Response 200 JSON: { status: "sent", sms_id: <id>, ... } |
//                       { error: "<code>" }
//
// Тело запроса к функции (без изменений для совместимости с фронтом):
//   { phone: E164, text: string, contact_id?: uuid, deal_id?: uuid }
//   ИЛИ
//   { recipients: [{ phone, contact_id?, deal_id? }, ...], text: string }
//
// Проверки: JWT + has_role_v2 (employee|admin|super_admin). Credentials читаются
// из integration_credentials.provider='websms' (внутренний ключ сохранён для
// обратной совместимости; внешнее название бренда — SMS.by).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PROVIDER = "websms"; // internal key — preserved
const DEFAULT_BASE_URL = "https://app.sms.by";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(input: string): string | null {
  const digits = String(input ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
}

function toMsisdn(phoneE164: string): string {
  // SMS.by ожидает phone без '+'
  return phoneE164.replace(/^\+/, "");
}

interface Recipient {
  phone: string;
  contact_id?: string | null;
  deal_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // ── 1. JWT ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "missing_auth" });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "invalid_jwt" });
  const userId = userData.user.id;

  // ── 2. Body ──────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const text = String(body?.text ?? "").trim();
  if (!text) return json(400, { error: "empty_text" });
  if (text.length > 1000) return json(400, { error: "text_too_long" });

  let recipients: Recipient[] = [];
  if (Array.isArray(body?.recipients) && body.recipients.length > 0) {
    recipients = body.recipients;
  } else if (body?.phone) {
    recipients = [
      { phone: body.phone, contact_id: body.contact_id, deal_id: body.deal_id },
    ];
  } else {
    return json(400, { error: "no_recipients" });
  }
  if (recipients.length > 500) return json(400, { error: "too_many_recipients" });

  const normalized: Recipient[] = [];
  for (const r of recipients) {
    const p = normalizePhone(r.phone);
    if (p) normalized.push({ ...r, phone: p });
  }
  if (normalized.length === 0) return json(400, { error: "invalid_phones" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 3. Роль ──────────────────────────────────────────────────────────────
  const roleChecks = await Promise.all(
    (["employee", "admin", "super_admin"] as const).map((r) =>
      admin.rpc("has_role_v2", { _user_id: userId, _role_code: r }),
    ),
  );
  if (!roleChecks.some((r) => r.data === true)) {
    return json(403, { error: "not_staff" });
  }

  // ── 4. Integration enabled ──────────────────────────────────────────────
  const { data: integ } = await admin
    .from("integrations")
    .select("is_enabled")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!integ) return json(412, { error: "integration_not_configured" });
  if (!integ.is_enabled) return json(412, { error: "integration_disabled" });

  // ── 5. Credentials ──────────────────────────────────────────────────────
  const { data: credRows } = await admin
    .from("integration_credentials")
    .select("config, secrets")
    .eq("provider", PROVIDER);
  const cfg = (credRows ?? []).reduce<{ config: any; secrets: any }>(
    (acc, row) => ({
      config: { ...acc.config, ...(row.config ?? {}) },
      secrets: { ...acc.secrets, ...(row.secrets ?? {}) },
    }),
    { config: {}, secrets: {} },
  );
  const token = String(cfg.secrets?.token ?? cfg.secrets?.apikey ?? "").trim();
  const alphanameId = cfg.config?.alphaname_id != null && cfg.config?.alphaname_id !== ""
    ? String(cfg.config.alphaname_id).trim()
    : "";
  const alphanameLabel = String(cfg.config?.alphaname ?? cfg.config?.sender ?? "").trim();
  const baseUrl = String(cfg.config?.base_url ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!token) {
    return json(412, { error: "smsby_credentials_missing" });
  }

  // ── 6. Pre-insert sms_messages rows (status=queued) ─────────────────────
  const initialRows = normalized.map((r) => ({
    contact_id: r.contact_id ?? null,
    deal_id: r.deal_id ?? null,
    phone_e164: r.phone,
    text,
    provider: "smsby",
    status: "queued",
    sender: alphanameLabel || null,
    initiator_user_id: userId,
  }));
  const { data: inserted, error: insertErr } = await admin
    .from("sms_messages")
    .insert(initialRows)
    .select("id, phone_e164");
  if (insertErr || !inserted) {
    return json(500, {
      error: "sms_insert_failed",
      detail: insertErr?.message,
    });
  }

  // ── 7. Запросы к SMS.by (по одному per recipient) ────────────────────────
  const startedFetch = Date.now();
  let sentCount = 0;
  let failedCount = 0;
  const sampleResponses: any[] = [];

  for (const row of inserted) {
    const params = new URLSearchParams({
      token,
      message: text,
      phone: toMsisdn(row.phone_e164),
    });
    if (alphanameId) params.set("alphaname_id", alphanameId);
    const url = `${baseUrl}/api/v1/sendQuickSMS?${params.toString()}`;

    let respText = "";
    let httpStatus = 0;
    let respJson: any = null;
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      httpStatus = resp.status;
      respText = await resp.text();
      try {
        respJson = JSON.parse(respText);
      } catch {
        respJson = null;
      }
    } catch (e: any) {
      failedCount++;
      await admin
        .from("sms_messages")
        .update({
          status: "failed",
          error: `fetch_failed: ${String(e?.message ?? e)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    const ok =
      httpStatus >= 200 &&
      httpStatus < 300 &&
      respJson &&
      !respJson.error &&
      (respJson.status === "sent" || respJson.sms_id != null);

    if (sampleResponses.length < 3) sampleResponses.push(respJson ?? respText.slice(0, 200));

    await admin
      .from("sms_messages")
      .update({
        status: ok ? "sent" : "failed",
        external_id: respJson?.sms_id != null ? String(respJson.sms_id) : null,
        cost: respJson?.cost ?? null,
        segments: respJson?.parts ?? null,
        error: ok
          ? null
          : String(respJson?.error ?? `http_${httpStatus}: ${respText.slice(0, 200)}`),
        metadata: {
          smsby_request: {
            url: `${baseUrl}/api/v1/sendQuickSMS`,
            alphaname_id: alphanameId || null,
            sent_at: new Date().toISOString(),
          },
          smsby_response: {
            http_status: httpStatus,
            body: respJson ?? respText.slice(0, 1000),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (ok) sentCount++;
    else failedCount++;
  }

  const latencyMs = Date.now() - startedFetch;
  console.log(
    "websms-send",
    JSON.stringify({
      provider: "smsby",
      recipients: inserted.length,
      sent: sentCount,
      failed: failedCount,
      latency_ms: latencyMs,
      sample: sampleResponses,
    }),
  );

  if (sentCount === 0) {
    return json(502, {
      error: "smsby_api_error",
      detail: sampleResponses[0] ?? "no_response",
    });
  }

  return json(200, {
    ok: true,
    count: sentCount,
    failed: failedCount,
    sms_ids: inserted.map((r) => r.id),
  });
});
