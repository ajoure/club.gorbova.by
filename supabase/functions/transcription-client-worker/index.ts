// ============================================================================
// transcription-client-worker
//
// Client-assisted transcription pipeline for long recordings that cannot be
// transcribed as a single Lovable AI request (Gateway hard-caps
// /v1/audio/transcriptions at ~25 MiB). The browser chunks the ready audio
// asset into small WAV windows and uploads them one at a time; this worker
// runs each chunk through STT, persists per-part transcripts, then assembles
// the final DOCX exactly like `live-event-media.apply_transcript_text`.
//
// Actions (JSON POST unless noted):
//  - create_job     { live_event_id, audio_duration_ms, window_ms }
//  - register_parts { job_id, parts:[{part_index,start_ms,end_ms,bytes?}] }
//  - transcribe_part MULTIPART: action=transcribe_part, job_id, part_index, file
//  - status         { job_id? , live_event_id? }
//  - finalize       { job_id }
//  - cancel         { job_id }
//
// Auth: authenticated + admin/super_admin OR event presenter (matches
// live-event-media). Service role client is used for all writes so cascade
// counters and DOCX generation stay authoritative on the server side.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLiveEventTranscriptDocx } from "../_shared/live-event-transcript-docx.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const BUCKET = "live-event-media";
const MAX_PART_BYTES = 24 * 1024 * 1024;
const MIN_PART_BYTES = 2048;
const STT_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const STT_MODEL = "openai/gpt-4o-transcribe";
const DEFAULT_WINDOW_MS = 90_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { error: json({ error: "unauthorized" }, 401) };
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { error: json({ error: "unauthorized" }, 401) };
  return { user };
}

async function canManage(service: any, userId: string, eventId: string) {
  const [admin, superAdmin, presenter] = await Promise.all([
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "admin" }),
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "super_admin" }),
    service.rpc("is_live_event_presenter", { _user_id: userId, _live_event_id: eventId }),
  ]);
  return admin.data === true || superAdmin.data === true || presenter.data === true;
}

async function loadJob(service: any, jobId: string) {
  const { data, error } = await service
    .from("live_event_client_transcription_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`job_load_failed:${error.message}`);
  return data;
}

async function recomputeCounters(service: any, jobId: string) {
  const { data: parts, error } = await service
    .from("live_event_client_transcription_job_parts")
    .select("status")
    .eq("job_id", jobId);
  if (error) throw error;
  const completed = parts?.filter((p: any) => p.status === "ready").length ?? 0;
  const failed = parts?.filter((p: any) => p.status === "failed").length ?? 0;
  await service
    .from("live_event_client_transcription_jobs")
    .update({
      completed_parts: completed,
      failed_parts: failed,
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  return { completed, failed };
}

async function handleCreateJob(service: any, user: any, body: any) {
  const eventId = String(body?.live_event_id || "");
  const durationMs = Math.max(1_000, Math.floor(Number(body?.audio_duration_ms) || 0));
  const windowMs = Math.max(5_000, Math.min(300_000, Math.floor(Number(body?.window_ms) || DEFAULT_WINDOW_MS)));
  if (!eventId || !durationMs) return json({ error: "missing_event_or_duration" }, 400);
  if (!(await canManage(service, user.id, eventId))) return json({ error: "forbidden" }, 403);

  const { data: audio } = await service
    .from("live_event_audio_assets")
    .select("id, storage_bucket, storage_path, size_bytes")
    .eq("live_event_id", eventId)
    .eq("status", "ready")
    .order("copied_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!audio?.id) return json({ error: "audio_not_ready" }, 409);

  const totalParts = Math.max(1, Math.ceil(durationMs / windowMs));

  // Resume the latest still-active job for the same audio asset.
  const { data: existing } = await service
    .from("live_event_client_transcription_jobs")
    .select("*")
    .eq("live_event_id", eventId)
    .eq("audio_asset_id", audio.id)
    .in("status", ["pending_parts", "transcribing", "finalizing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return json({ ok: true, job: existing, resumed: true });
  }

  const { data: job, error } = await service
    .from("live_event_client_transcription_jobs")
    .insert({
      live_event_id: eventId,
      audio_asset_id: audio.id,
      requested_by: user.id,
      status: "pending_parts",
      stage: "preparing",
      total_parts: totalParts,
      completed_parts: 0,
      failed_parts: 0,
      audio_duration_ms: durationMs,
      window_ms: windowMs,
      heartbeat_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(`job_create_failed:${error.message}`);
  return json({ ok: true, job, resumed: false });
}

async function handleRegisterParts(service: any, user: any, body: any) {
  const jobId = String(body?.job_id || "");
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  if (!jobId || !parts.length) return json({ error: "missing_job_or_parts" }, 400);
  const job = await loadJob(service, jobId);
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!(await canManage(service, user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);

  const rows = parts
    .map((p: any) => ({
      job_id: jobId,
      part_index: Math.max(0, Math.floor(Number(p?.part_index))),
      start_ms: Math.max(0, Math.floor(Number(p?.start_ms) || 0)),
      end_ms: Math.max(0, Math.floor(Number(p?.end_ms) || 0)),
      bytes: p?.bytes != null ? Math.max(0, Math.floor(Number(p.bytes))) : null,
      status: "pending",
      attempts: 0,
    }))
    .filter((r: any) => Number.isFinite(r.part_index) && r.end_ms > r.start_ms);

  if (!rows.length) return json({ error: "no_valid_parts" }, 400);

  const { error } = await service
    .from("live_event_client_transcription_job_parts")
    .upsert(rows, { onConflict: "job_id,part_index", ignoreDuplicates: true });
  if (error) throw new Error(`register_parts_failed:${error.message}`);

  await service
    .from("live_event_client_transcription_jobs")
    .update({ stage: "uploading", heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);

  return json({ ok: true, registered: rows.length });
}

async function handleTranscribePart(service: any, user: any, form: FormData) {
  if (!LOVABLE_API_KEY) return json({ error: "missing_lovable_api_key" }, 500);
  const jobId = String(form.get("job_id") || "");
  const partIndex = Math.floor(Number(form.get("part_index")));
  const file = form.get("file") as File | null;
  if (!jobId || !Number.isFinite(partIndex) || !file) {
    return json({ error: "missing_job_index_or_file" }, 400);
  }
  if (file.size < MIN_PART_BYTES) return json({ error: "empty_part_file" }, 400);
  if (file.size > MAX_PART_BYTES) return json({ error: "part_file_too_large" }, 413);

  const job = await loadJob(service, jobId);
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!(await canManage(service, user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
  if (job.status === "cancelled") return json({ error: "job_cancelled" }, 409);

  const { data: partRow, error: partError } = await service
    .from("live_event_client_transcription_job_parts")
    .select("*")
    .eq("job_id", jobId)
    .eq("part_index", partIndex)
    .maybeSingle();
  if (partError) throw partError;
  if (!partRow) return json({ error: "part_not_registered" }, 404);
  if (partRow.status === "ready" && partRow.transcript_text) {
    return json({ ok: true, part: partRow, cached: true });
  }

  await service
    .from("live_event_client_transcription_job_parts")
    .update({ status: "uploading", attempts: (partRow.attempts ?? 0) + 1, bytes: file.size, error_code: null, error_message: null })
    .eq("id", partRow.id);
  await service
    .from("live_event_client_transcription_jobs")
    .update({ status: "transcribing", stage: "transcribing", heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const upstream = new FormData();
    upstream.append("model", STT_MODEL);
    upstream.append("language", "ru");
    upstream.append("file", file, `part_${String(partIndex).padStart(4, "0")}.wav`);
    const response = await fetch(STT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: upstream,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`stt_${response.status}:${detail}`);
    }
    const payload = await response.json();
    const text = String(payload?.text || "").trim();
    if (!text) throw new Error("empty_part_transcript");

    const { data: ready, error: readyError } = await service
      .from("live_event_client_transcription_job_parts")
      .update({
        status: "ready",
        transcript_text: text,
        transcribed_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      })
      .eq("id", partRow.id)
      .select("*")
      .single();
    if (readyError) throw readyError;
    const counters = await recomputeCounters(service, jobId);
    return json({ ok: true, part: ready, counters });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service
      .from("live_event_client_transcription_job_parts")
      .update({
        status: "failed",
        error_code: message.slice(0, 80),
        error_message: message.slice(0, 500),
      })
      .eq("id", partRow.id);
    const counters = await recomputeCounters(service, jobId);
    return json({ ok: false, code: "part_transcription_failed", message, counters }, 502);
  }
}

async function handleStatus(service: any, user: any, body: any) {
  const jobId = body?.job_id ? String(body.job_id) : null;
  const eventId = body?.live_event_id ? String(body.live_event_id) : null;
  let job: any = null;
  if (jobId) {
    job = await loadJob(service, jobId);
    if (!job) return json({ error: "job_not_found" }, 404);
  } else if (eventId) {
    const { data } = await service
      .from("live_event_client_transcription_jobs")
      .select("*")
      .eq("live_event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    job = data;
  } else {
    return json({ error: "missing_job_or_event" }, 400);
  }
  if (!job) return json({ ok: true, job: null, parts: [] });
  if (!(await canManage(service, user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
  const { data: parts, error } = await service
    .from("live_event_client_transcription_job_parts")
    .select("part_index, status, attempts, bytes, error_code, error_message, transcribed_at")
    .eq("job_id", job.id)
    .order("part_index", { ascending: true });
  if (error) throw error;
  return json({ ok: true, job, parts: parts ?? [] });
}

async function makeBrief(transcript: string) {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Ты редактор образовательных материалов. По расшифровке эфира верни валидный JSON: {\"executive_summary\":\"2-4 абзаца\",\"key_points\":[\"5-12 тезисов\"],\"action_items\":[\"практические шаги если прозвучали\"]}. Не выдумывай факты.",
          },
          { role: "user", content: `Расшифровка:\n\n${transcript.slice(0, 90_000)}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`brief_${response.status}`);
    const content = (await response.json())?.choices?.[0]?.message?.content || "";
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("brief_json_missing");
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return {
      executiveSummary: String(parsed.executive_summary || "").trim(),
      keyPoints: Array.isArray(parsed.key_points) ? parsed.key_points.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12) : [],
      actionItems: Array.isArray(parsed.action_items) ? parsed.action_items.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12) : [],
    };
  } catch (_e) {
    return { executiveSummary: "", keyPoints: [], actionItems: [] };
  }
}

async function handleFinalize(service: any, user: any, body: any) {
  const jobId = String(body?.job_id || "");
  if (!jobId) return json({ error: "missing_job" }, 400);
  const job = await loadJob(service, jobId);
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!(await canManage(service, user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);

  const { data: parts, error } = await service
    .from("live_event_client_transcription_job_parts")
    .select("part_index, status, transcript_text")
    .eq("job_id", jobId)
    .order("part_index", { ascending: true });
  if (error) throw error;
  const ready = (parts ?? []).filter((p: any) => p.status === "ready" && p.transcript_text);
  if (ready.length < job.total_parts) {
    return json({ error: "parts_incomplete", ready: ready.length, total: job.total_parts }, 409);
  }

  await service
    .from("live_event_client_transcription_jobs")
    .update({ status: "finalizing", stage: "finalizing", heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const transcript = ready.map((p: any) => p.transcript_text.trim()).filter(Boolean).join("\n\n").trim();
    if (transcript.length < 20) throw new Error("empty_transcript");

    const { data: event, error: eventError } = await service
      .from("live_events")
      .select("id, title, scheduled_at")
      .eq("id", job.live_event_id)
      .maybeSingle();
    if (eventError || !event) throw new Error("live_event_not_found");

    const brief = await makeBrief(transcript);
    const generatedAt = new Date().toISOString();
    const docx = await buildLiveEventTranscriptDocx({
      title: event.title,
      eventDate: event.scheduled_at,
      generatedAt,
      executiveSummary: brief.executiveSummary,
      keyPoints: brief.keyPoints,
      actionItems: brief.actionItems,
      transcript,
    });

    const { data: existingTranscript } = await service
      .from("live_event_transcripts")
      .select("id")
      .eq("audio_asset_id", job.audio_asset_id)
      .maybeSingle();
    const transcriptId = existingTranscript?.id;
    let row: any;
    if (transcriptId) {
      const { data, error: upErr } = await service
        .from("live_event_transcripts")
        .update({
          status: "processing",
          requested_by: user.id,
          error_code: null,
          error_message: null,
        })
        .eq("id", transcriptId)
        .select("*")
        .single();
      if (upErr) throw upErr;
      row = data;
    } else {
      const { data, error: insErr } = await service
        .from("live_event_transcripts")
        .insert({
          live_event_id: job.live_event_id,
          audio_asset_id: job.audio_asset_id,
          status: "processing",
          requested_by: user.id,
        })
        .select("*")
        .single();
      if (insErr) throw insErr;
      row = data;
    }

    const docxPath = `${job.live_event_id}/transcripts/${row.id}/transcription.docx`;
    const { error: uploadError } = await service.storage.from(BUCKET).upload(docxPath, docx, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (uploadError) throw new Error(`docx_upload_failed:${uploadError.message}`);

    const { data: readyTranscript, error: readyErr } = await service
      .from("live_event_transcripts")
      .update({
        status: "ready",
        transcript_text: transcript,
        executive_summary: brief.executiveSummary,
        key_points: brief.keyPoints,
        action_items: brief.actionItems,
        docx_storage_bucket: BUCKET,
        docx_storage_path: docxPath,
        generated_at: generatedAt,
        error_code: null,
        error_message: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (readyErr) throw readyErr;

    await service
      .from("live_event_client_transcription_jobs")
      .update({
        status: "ready",
        stage: "ready",
        finalized_at: generatedAt,
        heartbeat_at: generatedAt,
        error_code: null,
        error_message: null,
      })
      .eq("id", jobId);

    return json({ ok: true, transcript: readyTranscript });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service
      .from("live_event_client_transcription_jobs")
      .update({
        status: "failed",
        stage: "failed",
        error_code: message.slice(0, 80),
        error_message: message.slice(0, 500),
      })
      .eq("id", jobId);
    return json({ ok: false, error: "finalize_failed", message }, 500);
  }
}

async function handleCancel(service: any, user: any, body: any) {
  const jobId = String(body?.job_id || "");
  if (!jobId) return json({ error: "missing_job" }, 400);
  const job = await loadJob(service, jobId);
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!(await canManage(service, user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
  await service
    .from("live_event_client_transcription_jobs")
    .update({ status: "cancelled", stage: "failed", heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      return await handleTranscribePart(service, auth.user, form);
    }
    const body = await req.json().catch(() => ({}));
    switch (String(body?.action || "")) {
      case "create_job": return await handleCreateJob(service, auth.user, body);
      case "register_parts": return await handleRegisterParts(service, auth.user, body);
      case "status": return await handleStatus(service, auth.user, body);
      case "finalize": return await handleFinalize(service, auth.user, body);
      case "cancel": return await handleCancel(service, auth.user, body);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[transcription-client-worker]", message);
    return json({ error: "worker_failed", code: message.slice(0, 120) }, 500);
  }
});
