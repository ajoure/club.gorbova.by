// ============================================================================
// live-event-media
//
// Private media workflow for a finished live event:
//  1. imports the single audio track Kinescope produced for the replay;
//  2. lets an administrator or the assigned presenter download that audio;
//  3. creates a complete AI transcript and a formatted DOCX.
//
// No Kinescope credential or permanent provider download link is ever sent to
// the browser. The import is started after the existing "Синхронизировать
// Kinescope" action and can also be repeated manually without duplicates.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildLiveEventTranscriptDocx } from "../_shared/live-event-transcript-docx.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const KINESCOPE_V1 = "https://api.kinescope.io/v1";
const BUCKET = "live-event-media";
// Lovable AI Gateway hard-caps /v1/audio/transcriptions at ~25 MiB per request.
// We keep a small safety margin so streaming overhead does not push a borderline
// file over the wire limit.
const AUDIO_TRANSCRIBE_MAX_BYTES = 24 * 1024 * 1024;
const TRANSCRIBE_ENDPOINT = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "openai/gpt-4o-transcribe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "status" | "sync_audio" | "start_transcript" | "download" | "apply_transcript_text";
type DownloadKind = "audio" | "docx";

type AudioTrack = {
  id: string;
  language?: string | null;
  label?: string | null;
  file_size?: number | null;
  filetype?: string | null;
  original_name?: string | null;
  download_link?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeSegment(value: string | null | undefined, fallback: string) {
  const cleaned = (value || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function mimeForTrack(track: AudioTrack, responseType?: string | null) {
  if (responseType?.startsWith("audio/") || responseType === "video/mp4") return responseType;
  const type = (track.filetype || "").toLowerCase();
  if (type === "mp4" || type === "m4a") return "audio/mp4";
  if (type === "ogg" || type === "opus") return "audio/ogg";
  if (type === "webm") return "audio/webm";
  if (type === "wav") return "audio/wav";
  return "audio/mpeg";
}

function unwrap<T>(payload: any): T {
  return (payload?.data ?? payload) as T;
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

async function authenticate(req: Request, service: any) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return { error: json({ error: "unauthorized" }, 401) };

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { error: json({ error: "unauthorized" }, 401) };
  return { user };
}

async function canManageEvent(service: any, userId: string, eventId: string) {
  const [admin, superAdmin, presenter] = await Promise.all([
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "admin" }),
    service.rpc("has_role_v2", { _user_id: userId, _role_code: "super_admin" }),
    service.rpc("is_live_event_presenter", { _user_id: userId, _live_event_id: eventId }),
  ]);
  return admin.data === true || superAdmin.data === true || presenter.data === true;
}

async function getLiveEvent(service: any, eventId: string) {
  const { data, error } = await service
    .from("live_events")
    .select("id, title, scheduled_at, kinescope_video_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) throw new Error("live_event_not_found");
  return data as { id: string; title: string; scheduled_at: string | null; kinescope_video_id: string | null };
}

async function getKinescopeToken(service: any) {
  const { data, error } = await service
    .from("integration_instances")
    .select("config")
    .eq("provider", "kinescope")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  const token = (data?.config as Record<string, unknown> | null)?.api_token;
  if (error || typeof token !== "string" || !token) throw new Error("kinescope_not_connected");
  return token;
}

async function getKinescopeVideo(apiToken: string, videoId: string) {
  const response = await fetch(`${KINESCOPE_V1}/videos/${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (response.status === 404) throw new Error("kinescope_video_not_found");
  if (!response.ok) throw new Error(`kinescope_video_fetch_${response.status}`);
  return unwrap<{ id: string; status?: string; audio_tracks?: AudioTrack[] }>(await response.json());
}

function selectAudioTrack(video: { audio_tracks?: AudioTrack[] }) {
  const tracks = (video.audio_tracks || []).filter((track) => track?.id && track.download_link);
  return tracks.find((track) => String(track.language || "").toLowerCase() === "ru") || tracks[0] || null;
}

async function signedUrl(service: any, bucket: string, path: string) {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error("signed_url_failed");
  return data.signedUrl;
}

async function makeWebinarBrief(apiKey: string, transcript: string, fallbackSummary: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Ты редактор образовательных материалов. На основе только переданной расшифровки подготовь точную структуру для итогового документа. Не добавляй фактов, дат, цифр, ссылок или рекомендаций, которых в тексте нет. Верни только валидный JSON: {\"executive_summary\":\"2-4 содержательных абзаца\",\"key_points\":[\"5-12 конкретных тезисов\"],\"action_items\":[\"практические шаги только если они прямо прозвучали\"]}.",
        },
        { role: "user", content: `Полная расшифровка эфира:\n\n${transcript}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`ai_summary_${response.status}`);
  const content = (await response.json())?.choices?.[0]?.message?.content || "";
  try {
    const parsed = parseJsonObject(content);
    return {
      executiveSummary: String(parsed.executive_summary || fallbackSummary).trim(),
      keyPoints: stringList(parsed.key_points, 12),
      actionItems: stringList(parsed.action_items, 12),
    };
  } catch {
    return { executiveSummary: fallbackSummary, keyPoints: [], actionItems: [] };
  }
}

async function syncAudio(service: any, eventId: string) {
  const event = await getLiveEvent(service, eventId);
  if (!event.kinescope_video_id) return { ok: false, code: "replay_not_ready", status: 409 };

  const token = await getKinescopeToken(service);
  const video = await getKinescopeVideo(token, event.kinescope_video_id);
  if (video.status && video.status !== "done") return { ok: false, code: "video_processing", status: 409 };

  const track = selectAudioTrack(video);
  if (!track) return { ok: false, code: "audio_not_available", status: 409 };

  const { data: existing } = await service
    .from("live_event_audio_assets")
    .select("*")
    .eq("live_event_id", event.id)
    .eq("source_video_id", event.kinescope_video_id)
    .eq("source_track_id", track.id)
    .maybeSingle();

  if (existing?.status === "ready" && existing.storage_path) return { ok: true, audio: existing, cached: true };

  const source = await fetch(track.download_link!);
  if (!source.ok || !source.body) throw new Error(`kinescope_audio_download_${source.status}`);
  const mimeType = mimeForTrack(track, source.headers.get("content-type"));
  const sourceName = safeSegment(track.original_name, `audio.${track.filetype || "mp4"}`);
  const path = `${event.id}/${safeSegment(event.kinescope_video_id, "video")}/${safeSegment(track.id, "track")}/${sourceName}`;

  const pending = {
    live_event_id: event.id,
    source_video_id: event.kinescope_video_id,
    source_track_id: track.id,
    source_language: track.language || null,
    source_file_name: track.original_name || sourceName,
    source_file_type: track.filetype || null,
    source_file_size: track.file_size || null,
    storage_bucket: BUCKET,
    storage_path: path,
    mime_type: mimeType,
    status: "copying",
    error_code: null,
    error_message: null,
  };

  let audio = existing;
  if (existing) {
    const { data, error } = await service.from("live_event_audio_assets").update(pending).eq("id", existing.id).select("*").single();
    if (error) throw error;
    audio = data;
  } else {
    const { data, error } = await service.from("live_event_audio_assets").insert(pending).select("*").single();
    if (error) throw error;
    audio = data;
  }

  // Stream Kinescope → private Storage. The audio is not buffered in the browser
  // and the provider's short-lived download URL is never stored in Postgres.
  const objectUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const upload = await fetch(objectUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "Content-Type": mimeType,
      // Same event/video/track is the idempotency key. A retry must be able to
      // replace a partially uploaded object from a failed earlier attempt.
      "x-upsert": "true",
    },
    body: source.body,
  });

  if (!upload.ok) {
    const providerError = (await upload.text()).slice(0, 300);
    await service.from("live_event_audio_assets").update({
      status: "failed",
      error_code: "storage_upload_failed",
      error_message: providerError,
    }).eq("id", audio.id);
    throw new Error("storage_upload_failed");
  }

  const contentLength = Number(source.headers.get("content-length") || 0) || track.file_size || null;
  const { data: ready, error: readyError } = await service.from("live_event_audio_assets").update({
    status: "ready",
    size_bytes: contentLength,
    copied_at: new Date().toISOString(),
    error_code: null,
    error_message: null,
  }).eq("id", audio.id).select("*").single();
  if (readyError) throw readyError;
  return { ok: true, audio: ready, cached: false };
}

async function generateTranscript(service: any, eventId: string, actorId: string, force = false) {
  if (!LOVABLE_API_KEY) throw new Error("missing_lovable_api_key");
  const event = await getLiveEvent(service, eventId);
  const { data: audio } = await service
    .from("live_event_audio_assets")
    .select("*")
    .eq("live_event_id", eventId)
    .eq("status", "ready")
    .order("copied_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!audio?.storage_path) return { ok: false, code: "audio_not_ready", status: 409 };

  const { data: existing } = await service
    .from("live_event_transcripts")
    .select("*")
    .eq("audio_asset_id", audio.id)
    .maybeSingle();
  // Idempotent: a completed transcript for this exact audio asset is returned
  // as-is unless the caller explicitly requests a rebuild.
  if (!force && existing?.status === "ready" && existing.docx_storage_path) return { ok: true, transcript: existing, cached: true };

  // Guard the OOM path up-front: the gateway rejects transcription bodies over
  // ~25 MiB, and buffering more than that also crashes the edge worker. Long
  // recordings must be handled out-of-band via `apply_transcript_text`.
  const knownSize = Number(audio.size_bytes || audio.source_file_size || 0);
  if (knownSize && knownSize > AUDIO_TRANSCRIBE_MAX_BYTES) {
    return { ok: false, code: "audio_too_large", status: 413, size_bytes: knownSize, max_bytes: AUDIO_TRANSCRIBE_MAX_BYTES };
  }

  const pending = {
    live_event_id: eventId,
    audio_asset_id: audio.id,
    status: "processing",
    requested_by: actorId,
    error_code: null,
    error_message: null,
  };
  let transcriptRow = existing;
  if (existing) {
    const { data, error } = await service.from("live_event_transcripts").update(pending).eq("id", existing.id).select("*").single();
    if (error) throw error;
    transcriptRow = data;
  } else {
    const { data, error } = await service.from("live_event_transcripts").insert(pending).select("*").single();
    if (error) throw error;
    transcriptRow = data;
  }

  try {
    // Stream from private Storage → gateway as multipart. No base64, no full
    // buffering of the file in worker memory.
    const { data: blob, error: downloadError } = await service.storage.from(audio.storage_bucket || BUCKET).download(audio.storage_path);
    if (downloadError || !blob) throw new Error("stored_audio_download_failed");
    if (blob.size < 4096) throw new Error("audio_too_small");
    if (blob.size > AUDIO_TRANSCRIBE_MAX_BYTES) {
      // Size becomes known only after download for legacy rows without size_bytes.
      await service.from("live_event_transcripts").update({
        status: "failed",
        error_code: "audio_too_large",
        error_message: `size=${blob.size} bytes exceeds ${AUDIO_TRANSCRIBE_MAX_BYTES}`,
      }).eq("id", transcriptRow.id);
      return { ok: false, code: "audio_too_large", status: 413, size_bytes: blob.size, max_bytes: AUDIO_TRANSCRIBE_MAX_BYTES };
    }

    const mime = audio.mime_type || blob.type || "audio/mp4";
    const ext = ({ "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" } as Record<string, string>)[mime.split(";")[0]] ?? "mp4";
    const form = new FormData();
    form.append("model", TRANSCRIBE_MODEL);
    form.append("language", "ru");
    form.append("file", blob, `recording.${ext}`);
    const sttResponse = await fetch(TRANSCRIBE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: form,
    });
    if (!sttResponse.ok) {
      const detail = (await sttResponse.text().catch(() => "")).slice(0, 300);
      throw new Error(`stt_${sttResponse.status}${detail ? `:${detail}` : ""}`);
    }
    const sttPayload = await sttResponse.json();
    const transcript = String(sttPayload?.text || "").trim();
    if (!transcript) throw new Error("empty_transcript");

    const brief = await makeWebinarBrief(LOVABLE_API_KEY, transcript, "");
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
    const docxPath = `${eventId}/transcripts/${transcriptRow.id}/transcription.docx`;
    const { error: docxUploadError } = await service.storage.from(BUCKET).upload(docxPath, docx, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (docxUploadError) throw new Error("docx_upload_failed");

    const { data: ready, error: readyError } = await service.from("live_event_transcripts").update({
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
    }).eq("id", transcriptRow.id).select("*").single();
    if (readyError) throw readyError;
    return { ok: true, transcript: ready, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service.from("live_event_transcripts").update({
      status: "failed",
      error_code: message.slice(0, 80),
      error_message: message.slice(0, 500),
    }).eq("id", transcriptRow.id);
    throw error;
  }
}

function runInBackground(work: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work);
    return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action as Action | undefined;
    const eventId = typeof body?.live_event_id === "string" ? body.live_event_id : "";
    if (!action || !eventId) return json({ error: "missing_action_or_live_event_id" }, 400);

    const auth = await authenticate(req, service);
    if ("error" in auth) return auth.error;
    if (!(await canManageEvent(service, auth.user.id, eventId))) return json({ error: "forbidden" }, 403);

    if (action === "status") {
      const [{ data: audio }, { data: transcript }] = await Promise.all([
        service.from("live_event_audio_assets").select("*").eq("live_event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        service.from("live_event_transcripts").select("id, status, docx_storage_path, generated_at, error_code, error_message, created_at, updated_at").eq("live_event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return json({ ok: true, audio: audio || null, transcript: transcript || null });
    }

    if (action === "sync_audio") {
      const result = await syncAudio(service, eventId);
      return json(result, result.status || 200);
    }

    if (action === "start_transcript") {
      // A complete live recording can take much longer than a browser request.
      // Persisted statuses are the source of truth: the UI polls them and never
      // treats the immediate response as a completed DOCX.
      const work = generateTranscript(service, eventId, auth.user.id, body?.force === true)
        .then((result) => {
          if (!result.ok) console.warn("[live-event-media] transcript was not started:", result.code);
        })
        .catch((error) => console.error("[live-event-media] transcript background task failed:", error));
      if (runInBackground(work)) return json({ ok: true, status: "accepted" }, 202);

      // This fallback is only for runtimes without EdgeRuntime (for example,
      // a direct local invocation); production uses the non-blocking branch.
      await work;
      return json({ ok: true, status: "completed" });
    }

    if (action === "download") {
      const kind = body?.kind as DownloadKind | undefined;
      if (kind === "audio") {
        const { data: audio } = await service.from("live_event_audio_assets").select("storage_bucket, storage_path, status").eq("live_event_id", eventId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!audio?.storage_path) return json({ error: "audio_not_ready" }, 409);
        return json({ ok: true, url: await signedUrl(service, audio.storage_bucket || BUCKET, audio.storage_path) });
      }
      if (kind === "docx") {
        const { data: transcript } = await service.from("live_event_transcripts").select("docx_storage_bucket, docx_storage_path, status").eq("live_event_id", eventId).eq("status", "ready").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!transcript?.docx_storage_path) return json({ error: "transcript_not_ready" }, 409);
        return json({ ok: true, url: await signedUrl(service, transcript.docx_storage_bucket || BUCKET, transcript.docx_storage_path) });
      }
      return json({ error: "invalid_download_kind" }, 400);
    }

    if (action === "apply_transcript_text") {
      // Internal admin fallback: accepts a pre-built transcript (e.g. produced
      // out-of-band from an audio file too large for a single edge invocation),
      // generates the executive summary + DOCX, uploads it and marks the
      // transcript row as ready. Audio must already be present as an asset.
      const transcriptText = typeof body?.transcript_text === "string" ? body.transcript_text.trim() : "";
      if (transcriptText.length < 200) return json({ error: "transcript_text_too_short" }, 400);
      if (!LOVABLE_API_KEY) return json({ error: "missing_lovable_api_key" }, 500);
      const event = await getLiveEvent(service, eventId);
      const { data: audio } = await service
        .from("live_event_audio_assets")
        .select("*")
        .eq("live_event_id", eventId)
        .eq("status", "ready")
        .order("copied_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!audio?.id) return json({ error: "audio_not_ready" }, 409);

      const { data: existing } = await service
        .from("live_event_transcripts")
        .select("*")
        .eq("audio_asset_id", audio.id)
        .maybeSingle();
      const pending = {
        live_event_id: eventId,
        audio_asset_id: audio.id,
        status: "processing",
        requested_by: auth.user.id,
        error_code: null,
        error_message: null,
      };
      let transcriptRow: any = existing;
      if (existing) {
        const { data, error } = await service.from("live_event_transcripts").update(pending).eq("id", existing.id).select("*").single();
        if (error) throw error;
        transcriptRow = data;
      } else {
        const { data, error } = await service.from("live_event_transcripts").insert(pending).select("*").single();
        if (error) throw error;
        transcriptRow = data;
      }

      try {
        const brief = await makeWebinarBrief(LOVABLE_API_KEY, transcriptText, "");
        const generatedAt = new Date().toISOString();
        const docx = await buildLiveEventTranscriptDocx({
          title: event.title,
          eventDate: event.scheduled_at,
          generatedAt,
          executiveSummary: brief.executiveSummary,
          keyPoints: brief.keyPoints,
          actionItems: brief.actionItems,
          transcript: transcriptText,
        });
        const docxPath = `${eventId}/transcripts/${transcriptRow.id}/transcription.docx`;
        const { error: docxUploadError } = await service.storage.from(BUCKET).upload(docxPath, docx, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
        if (docxUploadError) throw new Error("docx_upload_failed");
        const { data: ready, error: readyError } = await service.from("live_event_transcripts").update({
          status: "ready",
          transcript_text: transcriptText,
          executive_summary: brief.executiveSummary,
          key_points: brief.keyPoints,
          action_items: brief.actionItems,
          docx_storage_bucket: BUCKET,
          docx_storage_path: docxPath,
          generated_at: generatedAt,
          error_code: null,
          error_message: null,
        }).eq("id", transcriptRow.id).select("*").single();
        if (readyError) throw readyError;
        return json({ ok: true, transcript: ready });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await service.from("live_event_transcripts").update({
          status: "failed",
          error_code: message.slice(0, 80),
          error_message: message.slice(0, 500),
        }).eq("id", transcriptRow.id);
        throw error;
      }
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[live-event-media]", message);
    return json({ error: "media_operation_failed", code: message.slice(0, 120) }, 500);
  }
});
