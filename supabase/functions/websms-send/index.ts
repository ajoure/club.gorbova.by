// ============================================================================
// websms-send
// ----------------------------------------------------------------------------
// Отправка SMS через websms.by (REST API v3).
//
// Контракт websms.by (документация cp.websms.by/api/v3):
//   POST https://cp.websms.by/api/v3/send_sms
//   Body (JSON):
//   {
//     "user":   "<login>",
//     "apikey": "<apikey>",
//     "messages": [
//       {
//         "recipient":  "375291234567",
//         "message_id": "<uuid>",
//         "sms": { "sender": "<alphaname>", "text": "..." }
//       }, ...
//     ]
//   }
//   Response 200 { status: "success", sms_id: "...", parts: N, cost: ... } для
//   каждого получателя (формат может варьироваться от тарифа — храним сырой
//   ответ в metadata).
//
// Тело запроса к функции:
//   { phone: E164, text: string, contact_id?: uuid, deal_id?: uuid }
//   ИЛИ
//   { recipients: [{ phone, contact_id?, deal_id? }, ...], text: string }
//
// Проверки: JWT + has_role_v2 (staff|admin|super_admin). Credentials читаются
// из integration_credentials.provider='websms', integrations.is_enabled.
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
  // websms.by ожидает recipient без '+'
  return phoneE164.replace(/^\+/, "");
}

interface Recipient {
  phone: string; // E.164
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

  const normalized = recipients
    .map((r) => ({ ...r, phone: normalizePhone(r.phone) }))
    .filter((r) => !!r.phone) as Required<Pick<Recipient, "phone">> &
      Recipient[number] extends never ? Recipient[] : Recipient[];
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
    .eq("provider", "websms")
    .maybeSingle();
  if (!integ) return json(412, { error: "integration_not_configured" });
  if (!integ.is_enabled) return json(412, { error: "integration_disabled" });

  // ── 5. Credentials ──────────────────────────────────────────────────────
  const { data: credRows } = await admin
    .from("integration_credentials")
    .select("config, secrets")
    .eq("provider", "websms");
  const cfg = (credRows ?? []).reduce<{ config: any; secrets: any }>(
    (acc, row) => ({
      config: { ...acc.config, ...(row.config ?? {}) },
      secrets: { ...acc.secrets, ...(row.secrets ?? {}) },
    }),
    { config: {}, secrets: {} },
  );
  const login = String(cfg.secrets?.user ?? cfg.config?.user ?? "").trim();
  const apikey = String(cfg.secrets?.apikey ?? "").trim();
  const sender = String(cfg.config?.sender ?? "").trim();
  const baseUrl =
    String(cfg.config?.base_url ?? "https://cp.websms.by").replace(/\/+$/, "");
  if (!login || !apikey || !sender) {
    return json(412, { error: "websms_credentials_missing" });
  }

  // ── 6. Pre-insert sms_messages rows (status=queued) ─────────────────────
  const initialRows = normalized.map((r) => ({
    contact_id: r.contact_id ?? null,
    deal_id: r.deal_id ?? null,
    phone_e164: r.phone!,
    text,
    provider: "websms",
    status: "queued",
    sender,
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

  // ── 7. Запрос к websms.by ───────────────────────────────────────────────
  const payload = {
    user: login,
    apikey,
    messages: inserted.map((row) => ({
      recipient: toMsisdn(row.phone_e164),
      message_id: row.id,
      sms: { sender, text },
    })),
  };

  const url = `${baseUrl}/api/v3/send_sms`;
  const startedFetch = Date.now();
  let respText = "";
  let httpStatus = 0;
  let respJson: any = null;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    httpStatus = resp.status;
    respText = await resp.text();
    try {
      respJson = JSON.parse(respText);
    } catch {
      respJson = null;
    }
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);
    await admin
      .from("sms_messages")
      .update({
        status: "failed",
        error: `fetch_failed: ${errMsg}`,
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        inserted.map((r) => r.id),
      );
    return json(502, { error: "websms_fetch_failed", detail: errMsg });
  }

  const latencyMs = Date.now() - startedFetch;
  const reqMeta = {
    url,
    sender,
    recipients_count: inserted.length,
    sent_at: new Date().toISOString(),
    user_prefix: login.slice(0, 3),
  };
  const respMeta = {
    http_status: httpStatus,
    latency_ms: latencyMs,
    body_snippet: respText.slice(0, 2000),
  };
  console.log("websms-send", JSON.stringify({ reqMeta, respMeta }));

  if (httpStatus < 200 || httpStatus >= 300) {
    await admin
      .from("sms_messages")
      .update({
        status: "failed",
        error: `http_${httpStatus}: ${respText.slice(0, 300)}`,
        metadata: { websms_request: reqMeta, websms_response: respMeta },
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        inserted.map((r) => r.id),
      );
    return json(502, {
      error: "websms_api_error",
      http_status: httpStatus,
      body_snippet: respText.slice(0, 500),
    });
  }

  // Разбор ответа: формат varies; пытаемся вытащить по message_id.
  // Универсально: считаем, что все ушли в sent, если success.
  const byMessageId = new Map<string, any>();
  if (respJson && typeof respJson === "object") {
    const arr =
      (Array.isArray(respJson) && respJson) ||
      respJson.messages ||
      respJson.result ||
      respJson.data ||
      [];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const mid =
          item?.message_id ?? item?.client_id ?? item?.id ?? null;
        if (mid) byMessageId.set(String(mid), item);
      }
    }
  }

  // Обновляем по каждой строке
  for (const row of inserted) {
    const item = byMessageId.get(String(row.id));
    const ok = !item || item?.status === "success" || item?.status === "ok" || httpStatus === 200;
    await admin
      .from("sms_messages")
      .update({
        status: ok ? "sent" : "failed",
        external_id: item?.sms_id ?? item?.id ?? null,
        cost: item?.cost ?? null,
        segments: item?.parts ?? null,
        error: ok ? null : String(item?.error ?? item?.status ?? "unknown"),
        metadata: {
          websms_request: reqMeta,
          websms_response: respMeta,
          websms_item: item ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }

  return json(200, {
    ok: true,
    count: inserted.length,
    sms_ids: inserted.map((r) => r.id),
    http_status: httpStatus,
  });
});
