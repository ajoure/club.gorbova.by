// VOCHI webhook receiver (Phase 1).
// Auth: shared secret в заголовке X-Vochi-Token, сверяется с
//   integration_credentials.secrets.webhook_token для provider='vochi'
//   (workspace_id IS NULL в single-tenant MVP, либо ?workspace_id=<uuid>).
// Все события пишем в call_events; распознанные синхронизируем в calls (upsert).
// Нераспознанные звонки остаются как unresolved (link_status), без автосоздания контактов.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vochi-token, x-vochi-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROVIDER = "vochi";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Naive E.164 normalization: оставляем +/digits.
function toE164(input: unknown): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned.replace(/^0+/, "")}`;
}

function parseTs(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// VOCHI event → canonical call fields (без contact resolve).
function mapEventToCallPatch(eventType: string, p: any) {
  const direction = (p.direction === "out" || p.direction === "outbound")
    ? "outbound" : "inbound";

  const statusMap: Record<string, string> = {
    "call.started": "ringing",
    "call.ringing": "ringing",
    "call.answered": "answered",
    "call.ended": p.answered ? "completed" : (p.status === "busy" ? "busy" : "no_answer"),
    "call.failed": "failed",
    "call.cancelled": "cancelled",
    "call.voicemail": "voicemail",
    "call.recorded": p.status ?? "completed",
  };
  const status = statusMap[eventType] ?? (p.status ?? "queued");

  return {
    provider: PROVIDER,
    external_call_id: String(p.call_id ?? p.id ?? p.uuid ?? ""),
    direction,
    status,
    phone_from_raw: p.from ?? p.caller ?? null,
    phone_from_e164: toE164(p.from ?? p.caller),
    phone_to_raw: p.to ?? p.called ?? null,
    phone_to_e164: toE164(p.to ?? p.called),
    started_at: parseTs(p.started_at ?? p.start_time ?? p.ts_start),
    answered_at: parseTs(p.answered_at ?? p.answer_time),
    ended_at: parseTs(p.ended_at ?? p.end_time ?? p.ts_end),
    recording_provider: p.recording_url ? PROVIDER : null,
    recording_url: p.recording_url ?? null,
    recording_ready_at: p.recording_url ? new Date().toISOString() : null,
    metadata: { last_event: eventType, raw_keys: Object.keys(p ?? {}) },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const url = new URL(req.url);
  const workspaceParam = url.searchParams.get("workspace_id");
  const workspaceId = workspaceParam && /^[0-9a-f-]{36}$/i.test(workspaceParam) ? workspaceParam : null;

  // --- Auth: shared webhook token (header OR query — VOCHI panel can only set URL) ---
  const token =
    req.headers.get("x-vochi-token") ??
    url.searchParams.get("token") ??
    url.searchParams.get("vochi_token") ??
    "";
  const credQuery = admin
    .from("integration_credentials")
    .select("id, secrets, config, status")
    .eq("provider", PROVIDER)
    .limit(1);
  const { data: credRow, error: credErr } = workspaceId
    ? await credQuery.eq("workspace_id", workspaceId).maybeSingle()
    : await credQuery.is("workspace_id", null).maybeSingle();

  if (credErr) return json({ error: "credentials_lookup_failed", detail: credErr.message }, 500);
  if (!credRow) return json({ error: "integration_not_configured" }, 401);

  const expected = (credRow.secrets as any)?.webhook_token ?? null;
  // If no webhook_token is configured, accept any inbound (panel has no header support
  // and operator opted into URL-only mode). Otherwise require match via header or ?token=.
  if (expected && token !== expected) {
    return json({ error: "invalid_signature" }, 401);
  }

  // --- Event extraction ---
  const eventType = String(body.event ?? body.type ?? "unknown");
  const payload = body.data ?? body.payload ?? body;
  const externalCallId =
    payload?.call_id ?? payload?.id ?? payload?.uuid ?? body?.call_id ?? null;

  // 1) Always log event row
  const { error: evErr } = await admin.from("call_events").insert({
    workspace_id: workspaceId,
    provider: PROVIDER,
    external_call_id: externalCallId ? String(externalCallId) : null,
    event_type: eventType,
    payload: body,
    signature_ok: true,
    received_at: new Date().toISOString(),
  });
  if (evErr) {
    return json({ error: "event_log_failed", detail: evErr.message }, 500);
  }

  if (!externalCallId) {
    return json({ ok: true, note: "event_logged_without_call_id" });
  }

  // 2) Upsert canonical call row
  const patch = mapEventToCallPatch(eventType, payload);
  patch.external_call_id = String(externalCallId);

  const { data: callRow, error: upErr } = await admin
    .from("calls")
    .upsert(
      {
        workspace_id: workspaceId,
        link_status: "unresolved",
        ...patch,
      },
      { onConflict: "provider,external_call_id" },
    )
    .select("id")
    .single();

  if (upErr) {
    return json({ error: "call_upsert_failed", detail: upErr.message }, 500);
  }

  // 3) Link event → call
  await admin
    .from("call_events")
    .update({ call_id: callRow.id, processed_at: new Date().toISOString() })
    .eq("external_call_id", String(externalCallId))
    .is("call_id", null);

  // 4) Enqueue recording fetch (idempotent via dedupe_key)
  if (patch.recording_url) {
    await admin.from("call_sync_queue").upsert(
      {
        workspace_id: workspaceId,
        provider: PROVIDER,
        job_type: "recording_fetch",
        dedupe_key: `recording:${externalCallId}`,
        payload: { call_id: callRow.id, recording_url: patch.recording_url },
        next_run_at: new Date().toISOString(),
      },
      { onConflict: "provider,job_type,dedupe_key", ignoreDuplicates: true },
    );
  }

  // 5) Enqueue contact resolve (Phase 2 worker), без автосоздания контактов в Phase 1
  await admin.from("call_sync_queue").upsert(
    {
      workspace_id: workspaceId,
      provider: PROVIDER,
      job_type: "call_resolve",
      dedupe_key: `resolve:${externalCallId}`,
      payload: { call_id: callRow.id },
      next_run_at: new Date().toISOString(),
    },
    { onConflict: "provider,job_type,dedupe_key", ignoreDuplicates: true },
  );

  return json({ ok: true, call_id: callRow.id });
});
