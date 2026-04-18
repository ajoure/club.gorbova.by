/**
 * site-form-upload — guest file upload для FormBlock на сайте.
 *
 * Контракт:
 *   POST multipart/form-data
 *     - submission_token (UUID, генерируется на клиенте при открытии формы)
 *     - field_id (string, opaque)
 *     - file (File)
 *
 * Безопасность:
 *   - bucket training-assets НЕ открыт для anonymous INSERT;
 *   - запись идёт через service_role внутри edge function;
 *   - server-side allowlist по MIME + расширению; hard size limit 20 MB;
 *   - server НЕ доверяет клиентским maxSizeMB / allowedGroups;
 *   - имя файла санитизируется; путь жёстко ограничен префиксом form-uploads/{token}/;
 *   - чтение — только через training-assets-download с admin/superadmin guard.
 *
 * Orphan policy (1-я итерация): если submit формы не произошёл — файлы остаются в
 * form-uploads/ как временный мусор. Чистится отдельным maintenance-cron'ом
 * (вне scope этой задачи). Это осознанное ограничение первой итерации.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Hard limits — сервер НЕ доверяет клиенту
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Безопасный default-allow MIME (без executables / scripts)
const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/octet-stream", // fallback — но проверяем по расширению ниже
]);

// Жёсткий blocklist расширений (executables / scripts)
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".bash", ".zsh", ".ps1", ".psm1",
  ".php", ".py", ".rb", ".pl", ".js", ".jsx", ".ts", ".tsx", ".mjs",
  ".jar", ".class", ".dll", ".so", ".dylib", ".app", ".dmg", ".msi",
  ".deb", ".rpm", ".apk", ".ipa", ".vbs", ".wsf", ".reg", ".inf",
  ".pif", ".lnk", ".scr", ".cpl", ".hta", ".com", ".html", ".htm", ".svg",
]);

function safeFilename(name: string): string {
  const cleaned = (name || "file")
    .replace(/[^\w.\-_а-яёА-ЯЁ\s]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 120);
  return cleaned || "file";
}

function getExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.substring(idx).toLowerCase();
}

function isMimeAllowed(mime: string): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  if (ALLOWED_MIME_EXACT.has(m)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const form = await req.formData();
    const submissionToken = String(form.get("submission_token") || "");
    const fieldId = String(form.get("field_id") || "");
    const file = form.get("file");

    if (!UUID_RE.test(submissionToken)) {
      return new Response(JSON.stringify({ error: "Invalid submission_token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!fieldId || fieldId.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid field_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "file is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (file.size <= 0) {
      return new Response(JSON.stringify({ error: "Empty file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return new Response(
        JSON.stringify({ error: `File too large (max ${MAX_SIZE_BYTES / 1024 / 1024} MB)` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ext = getExt(file.name);
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return new Response(JSON.stringify({ error: "File type not allowed" }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // MIME проверка: либо MIME в allowlist, либо octet-stream + не blocked extension
    const mime = file.type || "application/octet-stream";
    if (!isMimeAllowed(mime)) {
      return new Response(JSON.stringify({ error: "MIME type not allowed" }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = safeFilename(file.name);
    const uuid = crypto.randomUUID();
    const path = `form-uploads/${submissionToken}/${uuid}-${safeName}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("training-assets")
      .upload(path, bytes, {
        contentType: mime,
        upsert: false,
      });

    if (uploadError) {
      console.error("[site-form-upload] upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Upload failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Структурированный объект для form_data
    const fileObject = {
      type: "file",
      bucket: "training-assets",
      path,
      filename: file.name,
      mime_type: mime,
      size: file.size,
    };

    return new Response(JSON.stringify({ success: true, file: fileObject }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[site-form-upload] unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
