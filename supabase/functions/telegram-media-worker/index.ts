import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_TOKEN = Deno.env.get("TELEGRAM_MEDIA_WORKER_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sanitizeFileName(name: string, defaultExt = ""): string {
  try {
    if (!name) return `file${defaultExt}`;
    const lastDot = name.lastIndexOf(".");
    const ext = lastDot > 0 ? name.slice(lastDot).toLowerCase() : defaultExt;
    const base = lastDot > 0 ? name.slice(0, lastDot) : name;

    const map: Record<string, string> = {
      а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",
      й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",
      у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",
      э:"e",ю:"yu",я:"ya",
    };

    let safe = base.toLowerCase();
    for (const [c, l] of Object.entries(map)) safe = safe.replaceAll(c, l);
    safe = safe
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_.-]/g, "")
      .replace(/_+/g, "_")
      .slice(0, 100);

    return `${safe || "file"}${ext}`;
  } catch {
    return `file${defaultExt}`;
  }
}

function inferContentType(fileType: string | null, fileName: string | null): string {
  if (fileType === "photo") return "image/jpeg";
  if (fileType === "video" || fileType === "video_note") return "video/mp4";
  if (fileType === "voice") return "audio/ogg";
  if (fileType === "audio") return "audio/mpeg";
  if (fileType === "document") {
    const ext = (fileName || "").split(".").pop()?.toLowerCase();
    const m: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
    };
    return m[ext || ""] || "application/octet-stream";
  }
  return "application/octet-stream";
}

async function fetchJsonWithTimeout(url: string, ms: number): Promise<unknown> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const res = await fetch(url, { signal: c.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchArrayBufferWithTimeout(url: string, ms: number): Promise<ArrayBuffer> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const res = await fetch(url, { signal: c.signal });
    return await res.arrayBuffer();
  } finally {
    clearTimeout(t);
  }
}

interface MediaJob {
  id: string;
  message_db_id: string;
  user_id: string;
  bot_id: string;
  telegram_file_id: string;
  file_type: string | null;
  file_name: string | null;
  attempts: number;
  status: string;
  last_error: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // SECURITY: require X-Worker-Token
  const token = req.headers.get("x-worker-token") || "";
  if (!WORKER_TOKEN || token !== WORKER_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const start = Date.now();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50);
  const userIdFilter: string | null = body.user_id || null;

  // Unlock stuck jobs (best-effort)
  try {
    await supabase.rpc("unlock_stuck_media_jobs", { stuck_seconds: 300 });
  } catch (e) {
    console.error("[WORKER] unlock_stuck failed:", e);
  }

  // Claim jobs atomically via RPC
  const { data: jobs, error: claimErr } = await supabase.rpc("claim_media_jobs", {
    p_limit: limit,
    p_user_id: userIdFilter,
  });

  if (claimErr) {
    return new Response(JSON.stringify({ ok: false, error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];
  let okCount = 0;
  let errCount = 0;

  for (const job of (jobs || []) as MediaJob[]) {
    const jobStart = Date.now();
    let status: "ok" | "error" = "ok";
    let lastError = "";
    let storageBucket: string | null = null;
    let storagePath: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;

    try {
      // Get bot token (stored as plain text in bot_token_encrypted)
      const { data: bot, error: botErr } = await supabase
        .from("telegram_bots")
        .select("bot_token_encrypted")
        .eq("id", job.bot_id)
        .single();

      if (botErr || !bot?.bot_token_encrypted) {
        throw new Error("bot_token_missing");
      }
      const botToken = bot.bot_token_encrypted as string;

      // Telegram getFile (3s timeout)
      const fileInfo = await fetchJsonWithTimeout(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(job.telegram_file_id)}`,
        3000
      ) as { ok?: boolean; result?: { file_path?: string } };

      if (!fileInfo?.ok || !fileInfo?.result?.file_path) {
        throw new Error("telegram_getFile_failed");
      }
      const filePath = fileInfo.result.file_path;

      // Download file (30s timeout)
      const tgUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
      const ab = await fetchArrayBufferWithTimeout(tgUrl, 30000);

      fileSize = ab.byteLength;
      if (fileSize > 30 * 1024 * 1024) {
        throw new Error("file_too_large_30mb");
      }

      mimeType = inferContentType(job.file_type, job.file_name);

      const safe = sanitizeFileName(
        job.file_name || "file",
        job.file_type === "photo" ? ".jpg" : ""
      );

      storageBucket = "telegram-media";
      storagePath = `chat-media/${job.user_id}/${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage
        .from(storageBucket)
        .upload(storagePath, ab, { contentType: mimeType, upsert: false });

      if (upErr) {
        throw new Error(`upload_failed:${upErr.message}`);
      }

      // Update telegram_messages.meta (merge existing)
      const { data: msgRow } = await supabase
        .from("telegram_messages")
        .select("meta")
        .eq("id", job.message_db_id)
        .single();

      const prevMeta = (msgRow?.meta ?? {}) as Record<string, unknown>;
      const nextMeta = {
        ...prevMeta,
        mime_type: mimeType,
        file_size: fileSize,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        upload_status: "ok",
        upload_error: null,
        webhook_stage: "worker_uploaded",
      };

      await supabase
        .from("telegram_messages")
        .update({ meta: nextMeta })
        .eq("id", job.message_db_id);

    } catch (e: unknown) {
      status = "error";
      lastError = String((e as Error)?.message || e).slice(0, 200);

      // Update telegram_messages.meta with error (merge)
      try {
        const { data: msgRow } = await supabase
          .from("telegram_messages")
          .select("meta")
          .eq("id", job.message_db_id)
          .single();

        const prevMeta = (msgRow?.meta ?? {}) as Record<string, unknown>;
        const nextMeta = {
          ...prevMeta,
          upload_status: "error",
          upload_error: lastError.slice(0, 120),
          webhook_stage: "worker_error",
        };

        await supabase
          .from("telegram_messages")
          .update({ meta: nextMeta })
          .eq("id", job.message_db_id);
      } catch (updateErr) {
        console.error("[WORKER] Failed to update message meta on error:", updateErr);
      }

    } finally {
      // Determine final job status
      const nextJobStatus = 
        status === "ok" ? "ok" : (job.attempts >= 3 ? "error" : "pending");

      await supabase
        .from("media_jobs")
        .update({
          status: nextJobStatus,
          last_error: status === "ok" ? null : lastError,
          locked_at: null,
        })
        .eq("id", job.id);

      // Audit log (best-effort, non-blocking)
      Promise.resolve(
        supabase.from("audit_logs").insert({
          actor_type: "system",
          actor_user_id: null,
          actor_label: "telegram-media-worker",
          action: "media_job_processed",
          meta: {
            job_id: job.id,
            message_db_id: job.message_db_id,
            status: nextJobStatus,
            ms: Date.now() - jobStart,
            error: status === "ok" ? null : lastError,
            storage_bucket: storageBucket,
            storage_path: storagePath,
            file_size: fileSize,
          },
        })
      ).then(() => {
        console.log(`[WORKER] Audit log written for job ${job.id}`);
      }).catch((err: unknown) => {
        console.error("[WORKER] Audit log failed:", err);
      });

      results.push({ 
        id: job.id, 
        status: nextJobStatus, 
        ...(lastError ? { error: lastError } : {}) 
      });
      
      if (status === "ok") okCount++; 
      else errCount++;

      // Small yield to prevent blocking
      await sleep(10);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: results.length,
      ok_count: okCount,
      error_count: errCount,
      ms: Date.now() - start,
      jobs: results.slice(0, 10),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
