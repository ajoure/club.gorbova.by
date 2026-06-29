// VOCHI sync queue worker (Phase 1).
// Processes pending call_sync_queue jobs with retry + exponential backoff.
// Idempotency: уникальный (provider, job_type, dedupe_key) гарантирует, что
// повторные постановки одной и той же работы не задвоят выполнение.
//
// Поддерживаемые job_type:
//   - recording_fetch: HEAD по recording_url; помечаем recording_stored=true,
//     если ответ 2xx и Content-Type начинается с audio/. Phase 2 — скачивание в bucket.
//   - call_resolve: попытка матчинга по phone_*_e164 → profiles.phone; контакт НЕ создаём.
//
// Триггер: запускается планировщиком (pg_cron) каждую минуту, либо вручную (admin-only).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

const BATCH_SIZE = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Exponential backoff с потолком 1 час, jitter ±20%.
function nextRunAfter(attempts: number): string {
  const baseSec = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
  const jitter = baseSec * (0.8 + Math.random() * 0.4);
  return new Date(Date.now() + jitter * 1000).toISOString();
}

async function processRecordingFetch(job: any): Promise<{ ok: boolean; error?: string }> {
  const url = job.payload?.recording_url as string | undefined;
  const callId = job.payload?.call_id as string | undefined;
  if (!url || !callId) return { ok: false, error: "missing_payload" };

  let head: Response;
  try {
    head = await fetch(url, { method: "HEAD" });
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${(e as Error).message}` };
  }
  if (!head.ok) return { ok: false, error: `head_status_${head.status}` };

  const ct = head.headers.get("content-type") ?? "";
  if (!ct.startsWith("audio/") && !ct.includes("octet-stream")) {
    return { ok: false, error: `unexpected_content_type:${ct}` };
  }

  // Phase 1: только пометка готовности. Скачивание в bucket — Phase 2.
  await admin
    .from("calls")
    .update({ recording_ready_at: new Date().toISOString() })
    .eq("id", callId);

  return { ok: true };
}

async function processCallResolve(job: any): Promise<{ ok: boolean; error?: string }> {
  const callId = job.payload?.call_id as string | undefined;
  if (!callId) return { ok: false, error: "missing_call_id" };

  const { data: call } = await admin
    .from("calls")
    .select("id, direction, phone_from_e164, phone_to_e164, contact_id, link_status")
    .eq("id", callId)
    .maybeSingle();
  if (!call) return { ok: false, error: "call_not_found" };
  if (call.contact_id) return { ok: true }; // уже привязан

  const phone = call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
  if (!phone) return { ok: true }; // нечем матчить — оставляем unresolved

  // Матч по profiles.phone (если поле есть). Контакт НЕ создаём.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  if (profile?.id) {
    await admin
      .from("calls")
      .update({ contact_id: profile.id, link_status: "linked" })
      .eq("id", callId);
  }
  // если не нашли — оставляем link_status='unresolved' для ручной обработки в UI
  return { ok: true };
}

async function processJob(job: any): Promise<void> {
  let result: { ok: boolean; error?: string } = { ok: false, error: "unknown_job_type" };

  if (job.job_type === "recording_fetch") {
    result = await processRecordingFetch(job);
  } else if (job.job_type === "call_resolve") {
    result = await processCallResolve(job);
  }

  if (result.ok) {
    await admin
      .from("call_sync_queue")
      .update({ done: true, done_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id);
    return;
  }

  const attempts = (job.attempts ?? 0) + 1;
  const exhausted = attempts >= (job.max_attempts ?? 8);
  await admin
    .from("call_sync_queue")
    .update({
      attempts,
      last_error: result.error ?? "unknown_error",
      next_run_at: exhausted ? job.next_run_at : nextRunAfter(attempts),
      done: exhausted,
      done_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("id", job.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Защита: только service role (cron) или admin JWT. Простейший gate — Authorization header
  // должен совпасть с SERVICE_ROLE (для pg_cron) или содержать валидный JWT с admin-ролью.
  // pg_cron вызывает с service-role bearer; ручной вызов из UI запрещён до Phase 2.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.includes(SERVICE_ROLE)) {
    return json({ error: "forbidden" }, 403);
  }

  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await admin
    .from("call_sync_queue")
    .select("*")
    .eq("done", false)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return json({ error: "queue_read_failed", detail: error.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  for (const job of jobs) {
    try {
      await processJob(job);
      processed++;
    } catch (e) {
      await admin
        .from("call_sync_queue")
        .update({
          attempts: (job.attempts ?? 0) + 1,
          last_error: `unhandled: ${(e as Error).message}`,
          next_run_at: nextRunAfter((job.attempts ?? 0) + 1),
        })
        .eq("id", job.id);
    }
  }

  return json({ ok: true, processed, scanned: jobs.length });
});
