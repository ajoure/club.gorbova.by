// ============================================================================
// transcription-client-worker
//
// Backend for the client-assisted live-event transcription flow. The admin
// browser tab decodes and chunks the audio locally (see src/lib/transcription
// /wavChunker.ts), then uploads one small WAV part at a time here. This
// function:
//
//  * creates or resumes a job for one (live_event_id, audio_asset_id) pair;
//  * transcribes one uploaded part via the Lovable AI /v1/audio/transcriptions
//    endpoint (server-side, so LOVABLE_API_KEY never leaves the backend);
//  * persists per-part transcript text so a browser reload can resume from
//    where it left off, and a failed part can be retried without redoing
//    successful ones;
//  * finalizes the job by concatenating ready parts in order, producing the
//    executive summary + DOCX, and marking live_event_transcripts ready.
//
// Access control matches live-event-media: admin, super_admin, or the
// live event's assigned presenter. LOVABLE_API_KEY is server-side only.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLiveEventTranscriptDocx } from "../_shared/live-event-transcript-docx.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const BUCKET = "live-event-media";
const TRANSCRIBE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "openai/gpt-4o-transcribe";
const PART_HARD_CAP_BYTES = 24 * 1024 * 1024;
const MAX_PART_ATTEMPTS = 5;

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

async function canManageEvent(service: ReturnType<typeof createClient>, userId: string, eventId: string) {
  const [admin, superAdmin, presenter] = await Promise.all([
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "admin" }),
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "super_admin" }),
    service.rpc("is_live_event_presenter", { _user_id: userId, _live_event_id: eventId }),
  ]);
  return admin.data === true || superAdmin.data === true || presenter.data === true;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ai_summary_json_missing");
  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
}

function stringList(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
    : [];
}

async function makeWebinarBrief(apiKey: string, transcript: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Ты помогаешь редактору сохранить итог онлайн-эфира. Верни JSON вида {\"executiveSummary\":\"...\",\"keyPoints\":[\"...\"],\"actionItems\":[\"...\"]}. executiveSummary — 4-6 предложений на русском, keyPoints и actionItems — 3-7 пунктов каждое, кратко и по делу.",
        },
        { role: "user", content: `Полная расшифровка эфира:\n\n${transcript}` },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`brief_failed_${response.status}:${body.slice(0, 120)}`);
  }
  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p: { text?: string }) => p?.text || "").join("") : "";
  const parsed = parseJsonObject(text);
  return {
    executiveSummary: String(parsed.executiveSummary || "").trim(),
    keyPoints: stringList(parsed.keyPoints, 8),
    actionItems: stringList(parsed.actionItems, 8),
  };
}

async function transcribePart(apiKey: string, wav: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append("model", TRANSCRIBE_MODEL);
  form.append("file", new Blob([wav], { type: "audio/wav" }), "part.wav");
  const response = await fetch(TRANSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`transcribe_failed_${response.status}:${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SERVICE_ROLE_KEY) return json({ error: "missing_service_role_key" }, 500);
  if (!LOVABLE_API_KEY) return json({ error: "missing_lovable_api_key" }, 500);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(body.action || "");
  const eventId = typeof body.live_event_id === "string" ? body.live_event_id : "";
  if (!action) return json({ error: "missing_action" }, 400);

  const auth = await authenticate(req);
  if ("error" in auth) return auth.error;

  try {
    if (action === "status") {
      if (!eventId) return json({ error: "missing_live_event_id" }, 400);
      if (!(await canManageEvent(service, auth.user.id, eventId))) return json({ error: "forbidden" }, 403);
      const { data: job } = await service
        .from("live_event_client_transcription_jobs")
        .select("*")
        .eq("live_event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!job) return json({ ok: true, job: null, parts: [] });
      const { data: parts } = await service
        .from("live_event_client_transcription_job_parts")
        .select("part_index, status, attempts, bytes, error_code, transcribed_at")
        .eq("job_id", job.id)
        .order("part_index", { ascending: true });
      return json({ ok: true, job, parts: parts || [] });
    }

    if (action === "create_or_resume") {
      if (!eventId) return json({ error: "missing_live_event_id" }, 400);
      if (!(await canManageEvent(service, auth.user.id, eventId))) return json({ error: "forbidden" }, 403);
      const totalParts = Number(body.total_parts);
      const windowMs = Number(body.window_ms) || 480_000;
      const durationMs = Number(body.audio_duration_ms) || null;
      const bounds = Array.isArray(body.bounds) ? body.bounds as Array<{ index: number; start_ms: number; end_ms: number }> : [];
      if (!Number.isFinite(totalParts) || totalParts < 1 || totalParts > 500) return json({ error: "invalid_total_parts" }, 400);
      if (bounds.length !== totalParts) return json({ error: "bounds_length_mismatch" }, 400);

      const { data: audio } = await service
        .from("live_event_audio_assets")
        .select("id, status, storage_bucket, storage_path")
        .eq("live_event_id", eventId)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!audio?.id || !audio.storage_path) return json({ error: "audio_not_ready" }, 409);

      const { data: existing } = await service
        .from("live_event_client_transcription_jobs")
        .select("*")
        .eq("live_event_id", eventId)
        .eq("audio_asset_id", audio.id)
        .in("status", ["pending_parts", "transcribing", "finalizing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let job = existing;
      if (!job) {
        const { data: created, error: createErr } = await service
          .from("live_event_client_transcription_jobs")
          .insert({
            live_event_id: eventId,
            audio_asset_id: audio.id,
            requested_by: auth.user.id,
            status: "pending_parts",
            stage: "uploading",
            total_parts: totalParts,
            window_ms: windowMs,
            audio_duration_ms: durationMs,
            heartbeat_at: new Date().toISOString(),
          })
          .select("*")
          .single();
        if (createErr || !created) throw createErr || new Error("job_create_failed");
        job = created;
        const rows = bounds.map((b) => ({
          job_id: created.id,
          part_index: b.index,
          start_ms: b.start_ms,
          end_ms: b.end_ms,
          status: "pending",
        }));
        const { error: partsErr } = await service.from("live_event_client_transcription_job_parts").insert(rows);
        if (partsErr) throw partsErr;
      } else {
        await service
          .from("live_event_client_transcription_jobs")
          .update({ heartbeat_at: new Date().toISOString(), stage: "uploading" })
          .eq("id", job.id);
      }

      const { data: parts } = await service
        .from("live_event_client_transcription_job_parts")
        .select("part_index, status, attempts")
        .eq("job_id", job!.id)
        .order("part_index", { ascending: true });

      const pending = (parts || [])
        .filter((p) => p.status !== "ready" && p.attempts < MAX_PART_ATTEMPTS)
        .map((p) => p.part_index);

      return json({ ok: true, job, pending_indices: pending, all_parts: parts || [] });
    }

    if (action === "submit_part") {
      const jobId = String(body.job_id || "");
      const partIndex = Number(body.part_index);
      const wavBase64 = String(body.wav_base64 || "");
      if (!jobId || !Number.isFinite(partIndex)) return json({ error: "invalid_payload" }, 400);
      if (!wavBase64) return json({ error: "missing_wav" }, 400);

      const { data: job } = await service
        .from("live_event_client_transcription_jobs")
        .select("id, live_event_id, status")
        .eq("id", jobId)
        .maybeSingle();
      if (!job) return json({ error: "job_not_found" }, 404);
      if (!(await canManageEvent(service, auth.user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
      if (["ready", "cancelled"].includes(job.status)) return json({ error: "job_not_active" }, 409);

      const { data: partRow } = await service
        .from("live_event_client_transcription_job_parts")
        .select("*")
        .eq("job_id", jobId)
        .eq("part_index", partIndex)
        .maybeSingle();
      if (!partRow) return json({ error: "part_not_found" }, 404);
      if (partRow.status === "ready") return json({ ok: true, cached: true, part: partRow });
      if (partRow.attempts >= MAX_PART_ATTEMPTS) return json({ error: "part_attempts_exhausted" }, 409);

      const bytes = base64ToBytes(wavBase64);
      if (bytes.length > PART_HARD_CAP_BYTES) return json({ error: "part_too_large" }, 413);

      await service
        .from("live_event_client_transcription_job_parts")
        .update({ status: "uploading", attempts: partRow.attempts + 1, bytes: bytes.length, error_code: null, error_message: null })
        .eq("id", partRow.id);
      await service
        .from("live_event_client_transcription_jobs")
        .update({ status: "transcribing", stage: "transcribing", heartbeat_at: new Date().toISOString() })
        .eq("id", jobId);

      try {
        const transcript = await transcribePart(LOVABLE_API_KEY, bytes);
        await service
          .from("live_event_client_transcription_job_parts")
          .update({ status: "ready", transcript_text: transcript, transcribed_at: new Date().toISOString(), error_code: null, error_message: null })
          .eq("id", partRow.id);
        const { count: readyCount } = await service
          .from("live_event_client_transcription_job_parts")
          .select("*", { count: "exact", head: true })
          .eq("job_id", jobId)
          .eq("status", "ready");
        await service
          .from("live_event_client_transcription_jobs")
          .update({ completed_parts: readyCount || 0, heartbeat_at: new Date().toISOString() })
          .eq("id", jobId);
        return json({ ok: true, part_index: partIndex, completed_parts: readyCount || 0 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await service
          .from("live_event_client_transcription_job_parts")
          .update({ status: "failed", error_code: message.slice(0, 80), error_message: message.slice(0, 500) })
          .eq("id", partRow.id);
        await service
          .from("live_event_client_transcription_jobs")
          .update({ failed_parts: (partRow.attempts || 0) + 1, heartbeat_at: new Date().toISOString() })
          .eq("id", jobId);
        return json({ ok: false, part_index: partIndex, error: "part_transcribe_failed", message }, 502);
      }
    }

    if (action === "finalize") {
      const jobId = String(body.job_id || "");
      if (!jobId) return json({ error: "missing_job_id" }, 400);
      const { data: job } = await service
        .from("live_event_client_transcription_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
      if (!job) return json({ error: "job_not_found" }, 404);
      if (!(await canManageEvent(service, auth.user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
      if (job.status === "ready") return json({ ok: true, cached: true, job });

      const { data: parts } = await service
        .from("live_event_client_transcription_job_parts")
        .select("part_index, status, transcript_text")
        .eq("job_id", jobId)
        .order("part_index", { ascending: true });
      const missing = (parts || []).filter((p) => p.status !== "ready").map((p) => p.part_index);
      if (missing.length > 0 || (parts?.length || 0) !== job.total_parts) {
        return json({ error: "parts_incomplete", missing }, 409);
      }
      const transcriptText = (parts || []).map((p) => (p.transcript_text || "").trim()).filter(Boolean).join("\n\n");
      if (transcriptText.length < 20) return json({ error: "assembled_transcript_empty" }, 500);

      await service
        .from("live_event_client_transcription_jobs")
        .update({ status: "finalizing", stage: "finalizing", heartbeat_at: new Date().toISOString() })
        .eq("id", jobId);

      const { data: event } = await service
        .from("live_events")
        .select("id, title, scheduled_at")
        .eq("id", job.live_event_id)
        .maybeSingle();
      if (!event) return json({ error: "live_event_not_found" }, 404);

      const { data: audio } = await service
        .from("live_event_audio_assets")
        .select("id")
        .eq("id", job.audio_asset_id)
        .maybeSingle();
      if (!audio) return json({ error: "audio_not_found" }, 404);

      // Upsert live_event_transcripts row for this audio asset.
      const { data: existingTranscript } = await service
        .from("live_event_transcripts")
        .select("id")
        .eq("audio_asset_id", audio.id)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const basePending = {
        live_event_id: job.live_event_id,
        audio_asset_id: audio.id,
        status: "processing",
        requested_by: job.requested_by || auth.user.id,
        error_code: null,
        error_message: null,
      };

      let transcriptRowId = existingTranscript?.id;
      if (transcriptRowId) {
        await service.from("live_event_transcripts").update(basePending).eq("id", transcriptRowId);
      } else {
        const { data: inserted, error: insertErr } = await service
          .from("live_event_transcripts")
          .insert(basePending)
          .select("id")
          .single();
        if (insertErr || !inserted) throw insertErr || new Error("transcript_row_failed");
        transcriptRowId = inserted.id;
      }

      try {
        const brief = await makeWebinarBrief(LOVABLE_API_KEY, transcriptText);
        const docx = await buildLiveEventTranscriptDocx({
          title: event.title,
          eventDate: event.scheduled_at,
          generatedAt: nowIso,
          executiveSummary: brief.executiveSummary,
          keyPoints: brief.keyPoints,
          actionItems: brief.actionItems,
          transcript: transcriptText,
        });
        const docxPath = `${job.live_event_id}/transcripts/${transcriptRowId}/transcription.docx`;
        const { error: uploadErr } = await service.storage
          .from(BUCKET)
          .upload(docxPath, docx, {
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: true,
          });
        if (uploadErr) throw new Error(`docx_upload_failed:${uploadErr.message || ""}`);

        await service
          .from("live_event_transcripts")
          .update({
            status: "ready",
            transcript_text: transcriptText,
            executive_summary: brief.executiveSummary,
            key_points: brief.keyPoints,
            action_items: brief.actionItems,
            docx_storage_bucket: BUCKET,
            docx_storage_path: docxPath,
            generated_at: nowIso,
            error_code: null,
            error_message: null,
          })
          .eq("id", transcriptRowId);
        await service
          .from("live_event_client_transcription_jobs")
          .update({ status: "ready", stage: "ready", finalized_at: nowIso, error_code: null, error_message: null })
          .eq("id", jobId);
        return json({ ok: true, job_id: jobId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await service
          .from("live_event_transcripts")
          .update({ status: "failed", error_code: message.slice(0, 80), error_message: message.slice(0, 500) })
          .eq("id", transcriptRowId);
        await service
          .from("live_event_client_transcription_jobs")
          .update({ status: "failed", stage: "failed", error_code: message.slice(0, 80), error_message: message.slice(0, 500) })
          .eq("id", jobId);
        return json({ ok: false, error: "finalize_failed", message }, 500);
      }
    }

    if (action === "cancel") {
      const jobId = String(body.job_id || "");
      if (!jobId) return json({ error: "missing_job_id" }, 400);
      const { data: job } = await service
        .from("live_event_client_transcription_jobs")
        .select("id, live_event_id, status")
        .eq("id", jobId)
        .maybeSingle();
      if (!job) return json({ error: "job_not_found" }, 404);
      if (!(await canManageEvent(service, auth.user.id, job.live_event_id))) return json({ error: "forbidden" }, 403);
      if (job.status === "ready") return json({ ok: true, cached: true });
      await service
        .from("live_event_client_transcription_jobs")
        .update({ status: "cancelled", stage: "failed" })
        .eq("id", jobId);
      return json({ ok: true });
    }

    if (action === "heartbeat") {
      const jobId = String(body.job_id || "");
      if (!jobId) return json({ error: "missing_job_id" }, 400);
      await service
        .from("live_event_client_transcription_jobs")
        .update({ heartbeat_at: new Date().toISOString() })
        .eq("id", jobId);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[transcription-client-worker]", message);
    return json({ error: "worker_failed", message: message.slice(0, 200) }, 500);
  }
});
