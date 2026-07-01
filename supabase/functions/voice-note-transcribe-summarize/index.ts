// ============================================================================
// voice-note-transcribe-summarize
// ----------------------------------------------------------------------------
// Расшифровывает голосовое сообщение из contact-files и пишет transcript/summary
// в contact_files.meta через тот же shared helper, что и звонки.
// Auth: требуется валидный JWT сотрудника (employee/admin/super_admin).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  audioFormatFromMime,
  base64FromBytes,
  transcribeAndSummarize,
  MIN_AUDIO_BYTES,
} from "../_shared/transcribe-audio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function updateMeta(service: any, fileId: string, patch: Record<string, any>) {
  const { data: row } = await service.from("contact_files").select("meta").eq("id", fileId).maybeSingle();
  const meta = (row?.meta && typeof row.meta === "object") ? row.meta : {};
  await service.from("contact_files").update({ meta: { ...meta, ...patch } }).eq("id", fileId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return jsonResponse({ error: "missing_lovable_api_key" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "unauthorized" }, 401);

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Guard: только staff
    const { data: isEmployee } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "employee" });
    const { data: isAdmin } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "admin" });
    const { data: isSuper } = await service.rpc("has_role_v2", { _user_id: user.id, _role: "super_admin" });
    if (!(isEmployee || isAdmin || isSuper)) return jsonResponse({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const fileId = body?.file_id as string | undefined;
    if (!fileId) return jsonResponse({ error: "missing_file_id" }, 400);

    const { data: file, error: fErr } = await service
      .from("contact_files")
      .select("id, storage_path, mime_type, size_bytes, meta")
      .eq("id", fileId)
      .maybeSingle();
    if (fErr || !file) return jsonResponse({ error: "file_not_found" }, 404);

    const status = (file.meta as any)?.transcribe_status;
    if (status === "done") return jsonResponse({ ok: true, cached: true, status });

    // Guard: слишком маленький файл → шум/тишина, галлюцинации
    if (typeof file.size_bytes === "number" && file.size_bytes > 0 && file.size_bytes < MIN_AUDIO_BYTES) {
      await updateMeta(service, fileId, {
        transcribe_status: "skipped_too_short",
        transcribe_reason: `size_${file.size_bytes}b_below_min_${MIN_AUDIO_BYTES}b`,
      });
      return jsonResponse({ ok: false, skipped: true, reason: "too_short", bytes: file.size_bytes });
    }

    await updateMeta(service, fileId, { transcribe_status: "processing", transcribe_reason: null });

    // Скачиваем через service_role — bucket приватный
    const { data: blob, error: dlErr } = await service.storage.from("contact-files").download(file.storage_path);
    if (dlErr || !blob) {
      await updateMeta(service, fileId, { transcribe_status: "failed", transcribe_reason: `download_failed:${dlErr?.message ?? "no_blob"}` });
      return jsonResponse({ error: "download_failed" }, 500);
    }

    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.byteLength < MIN_AUDIO_BYTES) {
      await updateMeta(service, fileId, { transcribe_status: "skipped_too_short", transcribe_reason: `bytes_${buf.byteLength}` });
      return jsonResponse({ ok: false, skipped: true, reason: "too_short", bytes: buf.byteLength });
    }

    const base64 = base64FromBytes(buf);
    const format = audioFormatFromMime(file.mime_type || blob.type || "audio/webm");

    try {
      const { transcript, summary } = await transcribeAndSummarize({
        apiKey: LOVABLE_API_KEY,
        base64,
        format,
        kind: "voice_note",
      });
      await updateMeta(service, fileId, {
        transcript,
        summary,
        transcribe_status: "done",
        transcribe_reason: null,
        transcribed_at: new Date().toISOString(),
      });
      return jsonResponse({ ok: true, transcript, summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateMeta(service, fileId, { transcribe_status: "failed", transcribe_reason: msg.slice(0, 500) });
      return jsonResponse({ error: msg }, 500);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[voice-note-transcribe-summarize] error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
