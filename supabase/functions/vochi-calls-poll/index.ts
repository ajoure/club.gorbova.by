// ============================================================================
// vochi-calls-poll
// ----------------------------------------------------------------------------
// Поллинг VOCHI /api/v1/calls для звонков, оставшихся в статусе queued/ringing
// после click-to-call (когда вебхук не приходит). Для каждого звонка делается
// запрос GET {base_url}/api/v1/calls?phone={e164} c Bearer api_token, и из
// полученного списка выбирается самый свежий matching call (по started_at и
// направлению). Затем обновляются status / started_at / answered_at / ended_at
// / external_call_id / recording_url в public.calls.
//
// Триггер: pg_cron каждую минуту (service-role bearer). Ручной вызов запрещён.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const POLL_WINDOW_MIN = 60; // смотрим только звонки моложе часа
const STALE_TIMEOUT_MIN = 30; // после 30 мин без обновлений — failed
const BATCH = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDigits(p?: string | null): string {
  return String(p ?? "").replace(/\D/g, "");
}

function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function mapVochiStatus(raw: any): string | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  if (["answered", "completed", "ended", "finished", "success", "ok"].includes(s)) return "completed";
  if (["no_answer", "noanswer", "missed", "unanswered"].includes(s)) return "no_answer";
  if (["busy"].includes(s)) return "busy";
  if (["failed", "error", "cancelled", "canceled", "rejected"].includes(s)) return "failed";
  if (["ringing", "calling", "in_progress", "active", "queued", "new"].includes(s)) return "ringing";
  return null;
}

async function fetchVochiCallsByPhone(
  baseUrl: string,
  apiToken: string,
  phoneE164: string,
): Promise<{ list: any[]; diag: any[] }> {
  const k = encodeURIComponent(apiToken);
  const p = encodeURIComponent(phoneE164);
  const candidates = [
    `${baseUrl}/api/v1/calls?phone=${p}&key=${k}`,
    `${baseUrl}/api/v1/calls?number=${p}&key=${k}`,
    `${baseUrl}/api/v1/calls?key=${k}`,
  ];
  const diag: any[] = [];
  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
      });
      const text = await resp.text().catch(() => "");
      const sample = text.slice(0, 300);
      diag.push({ url, status: resp.status, sample });
      console.log("[vochi-calls-poll] fetch", url, "status=", resp.status, "sample=", sample);
      if (!resp.ok) continue;
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { continue; }
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.data) ? parsed.data
        : Array.isArray(parsed?.calls) ? parsed.calls
        : Array.isArray(parsed?.items) ? parsed.items
        : Array.isArray(parsed?.result) ? parsed.result
        : [];
      if (list.length) return { list, diag };
    } catch (e) {
      diag.push({ url, error: String(e) });
      console.log("[vochi-calls-poll] fetch err", url, String(e));
    }
  }
  return { list: [], diag };
}

function matchCall(remote: any[], localStartedAt: string, phoneDigits: string): any | null {
  const localTs = new Date(localStartedAt).getTime();
  let best: { cand: any; score: number } | null = null;
  for (const c of remote) {
    const cPhone = normalizeDigits(
      pick<string>(c, "phone", "destination", "to", "callee", "external_number", "client_number"),
    );
    if (cPhone && !cPhone.endsWith(phoneDigits.slice(-9))) continue;
    const startRaw = pick(c, "started_at", "start_time", "start", "created_at", "date");
    const startTs = toIso(startRaw);
    const dt = startTs ? Math.abs(new Date(startTs).getTime() - localTs) : 1e15;
    if (dt > 30 * 60 * 1000) continue; // в пределах 30 мин
    const score = -dt;
    if (!best || score > best.score) best = { cand: c, score };
  }
  return best?.cand ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Auth: триггерится cron c anon-bearer (verify_jwt=false), либо service-role.
  // Внутри читаем БД через service-role — функция read-only безопасна, но всё же
  // запрещаем анонимный вызов без bearer.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "forbidden" }, 403);

  const { data: credRows, error: credErr } = await admin
    .from("integration_credentials")
    .select("config, secrets")
    .eq("provider", "vochi");
  if (credErr) return json({ error: "cred_lookup_failed", detail: credErr.message }, 500);
  if (!credRows?.length) return json({ ok: true, skipped: "no_credentials" });
  const mergedConfig: any = {};
  const mergedSecrets: any = {};
  for (const r of credRows) {
    Object.assign(mergedConfig, r.config ?? {});
    Object.assign(mergedSecrets, r.secrets ?? {});
  }
  const baseUrl = String(mergedConfig.base_url ?? "https://bot.vochi.by").replace(/\/+$/, "");
  const apiToken = mergedSecrets.api_token ?? mergedSecrets.api_key ?? "";
  if (!apiToken) return json({ ok: true, skipped: "no_api_token" });

  const sinceIso = new Date(Date.now() - POLL_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: pending, error: pendErr } = await admin
    .from("calls")
    .select("id, status, direction, phone_to_e164, phone_from_e164, started_at, external_call_id, metadata")
    .in("status", ["queued", "ringing"])
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true })
    .limit(BATCH);
  if (pendErr) return json({ error: "list_failed", detail: pendErr.message }, 500);
  if (!pending?.length) return json({ ok: true, processed: 0 });

  const staleCutoff = Date.now() - STALE_TIMEOUT_MIN * 60 * 1000;
  let updated = 0;
  let stale = 0;
  let missed = 0;

  for (const call of pending) {
    const phone = call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
    if (!phone) continue;
    const { list: remote, diag } = await fetchVochiCallsByPhone(baseUrl, apiToken, phone);
    const match = matchCall(remote, call.started_at, normalizeDigits(phone));

    if (!match) {
      // Если звонок завис дольше STALE_TIMEOUT_MIN — помечаем failed.
      if (new Date(call.started_at).getTime() < staleCutoff) {
        await admin
          .from("calls")
          .update({
            status: "failed",
            metadata: { ...(call.metadata ?? {}), poll_result: "stale_no_remote_match", poll_diag: diag },
          })
          .eq("id", call.id);
        stale++;
      } else {
        await admin
          .from("calls")
          .update({
            metadata: { ...(call.metadata ?? {}), poll_last_at: new Date().toISOString(), poll_diag: diag, poll_result: "no_match_yet" },
          })
          .eq("id", call.id);
        missed++;
      }
      continue;
    }

    const mappedStatus = mapVochiStatus(
      pick(match, "status", "state", "result", "disposition"),
    );
    const recordingUrl = pick<string>(match, "recording_url", "record_url", "recording", "audio_url");
    const startedAt = toIso(pick(match, "started_at", "start_time", "start", "created_at"));
    const answeredAt = toIso(pick(match, "answered_at", "answer_time", "answered"));
    const endedAt = toIso(pick(match, "ended_at", "end_time", "ended", "finished_at"));
    const externalId = pick<string>(match, "id", "call_id", "uuid", "uid");

    const patch: Record<string, any> = {};
    if (mappedStatus) patch.status = mappedStatus;
    if (recordingUrl) patch.recording_url = String(recordingUrl);
    if (startedAt && !call.started_at) patch.started_at = startedAt;
    if (answeredAt) patch.answered_at = answeredAt;
    if (endedAt) patch.ended_at = endedAt;
    if (externalId && String(call.external_call_id).startsWith("pending:")) {
      patch.external_call_id = String(externalId);
    }
    patch.metadata = {
      ...(call.metadata ?? {}),
      poll_last_at: new Date().toISOString(),
      poll_remote_snapshot: match,
    };

    const { error: updErr } = await admin.from("calls").update(patch).eq("id", call.id);
    if (!updErr) updated++;
  }

  return json({ ok: true, scanned: pending.length, updated, stale_failed: stale, no_match: missed });
});
