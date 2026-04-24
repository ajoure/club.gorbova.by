// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_PREFIXES = ["lesson-audio/", "lesson-files/", "lesson-images/", "student-uploads/", "ai-covers/", "training-covers/", "lesson-covers/"];
const LESSON_PREFIXES = ["lesson-audio/", "lesson-files/", "lesson-images/"];
const MAX_PATHS_PER_BATCH = 50;

/** Паттерны для извлечения storagePath из Supabase Storage URL (public, signed, raw) */
const STORAGE_URL_PATTERNS = [
  /\/storage\/v1\/object\/public\/training-assets\/(.+)/,
  /\/storage\/v1\/object\/sign\/training-assets\/([^?]+)/,
  /\/storage\/v1\/object\/training-assets\/(.+)/,
];

interface DeleteRequest {
  mode: "dry_run" | "execute";
  paths: string[];
  reason: string;
  entity?: { type: string; id: string };
}

// ─── Path validation (prefix + traversal only, no ownership) ───

function isPathAllowed(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.includes("..") || path.includes("//")) return false;
  if (path.startsWith("/")) return false;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// ─── Normalize value to storagePath ───
// Handles: raw storagePath, public URL, signed URL

function normalizeToStoragePath(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.startsWith("/") ? value.slice(1) : value;
  // Already a valid storage path
  if (ALLOWED_PREFIXES.some((p) => trimmed.startsWith(p))) {
    if (!trimmed.includes("..") && !trimmed.includes("//")) return trimmed;
  }
  // Try all URL patterns
  for (const pattern of STORAGE_URL_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      try {
        const path = decodeURIComponent(match[1]);
        if (ALLOWED_PREFIXES.some((p) => path.startsWith(p)) && !path.includes("..") && !path.includes("//")) {
          return path;
        }
      } catch {
        const path = match[1];
        if (ALLOWED_PREFIXES.some((p) => path.startsWith(p)) && !path.includes("..") && !path.includes("//")) {
          return path;
        }
      }
    }
  }
  return null;
}

// ─── Recursive path extractor from JSON (server-side version) ───

function extractPathsFromJson(obj: unknown): Set<string> {
  const found = new Set<string>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;

    // Direct path fields
    const sp = normalizeToStoragePath(record.storagePath);
    if (sp) found.add(sp);
    const sp2 = normalizeToStoragePath(record.storage_path);
    if (sp2) found.add(sp2);
    // URL fields (audio/file blocks store url)
    const urlPath = normalizeToStoragePath(record.url);
    if (urlPath) found.add(urlPath);

    // Recurse into all values
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (val && typeof val === "object") walk(val);
    }
  }

  walk(obj);
  return found;
}

// ─── Build DB-allowed set for a lesson ───

async function buildDbAllowedSet(
  adminClient: any,
  lessonId: string
): Promise<Set<string>> {
  const allowed = new Set<string>();

  // A) lesson_blocks.content
  const { data: blocks, error: bErr } = await adminClient
    .from("lesson_blocks")
    .select("content")
    .eq("lesson_id", lessonId);

  if (bErr) {
    console.error("[buildDbAllowedSet] lesson_blocks error:", bErr.message);
  } else if (blocks) {
    for (const block of blocks) {
      for (const p of extractPathsFromJson(block.content)) {
        if (ALLOWED_PREFIXES.some((pfx) => p.startsWith(pfx))) allowed.add(p);
      }
    }
  }

  // B) user_lesson_progress.response (student uploads)
  const { data: progress, error: pErr } = await adminClient
    .from("user_lesson_progress")
    .select("response")
    .eq("lesson_id", lessonId);

  if (pErr) {
    console.error("[buildDbAllowedSet] user_lesson_progress error:", pErr.message);
  } else if (progress) {
    for (const rec of progress) {
      for (const p of extractPathsFromJson(rec.response)) {
        if (ALLOWED_PREFIXES.some((pfx) => p.startsWith(pfx))) allowed.add(p);
      }
    }
  }

  return allowed;
}

// ─── Shared asset guard: find paths used by OTHER lessons ───

async function findSharedPaths(
  adminClient: ReturnType<typeof createClient>,
  lessonId: string,
  allowedPaths: string[]
): Promise<Set<string>> {
  const allowedSet = new Set(allowedPaths);
  const sharedSet = new Set<string>();

  // Paginated fetch: only blocks that reference training-assets
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: blocks, error } = await adminClient
      .from("lesson_blocks")
      .select("content")
      .neq("lesson_id", lessonId)
      .or("content->>url.ilike.%training-assets%,content->>storagePath.not.is.null,content->>storage_path.not.is.null")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[findSharedPaths] query error:", error.message);
      break;
    }

    if (!blocks || blocks.length === 0) {
      hasMore = false;
      break;
    }

    for (const block of blocks) {
      for (const p of extractPathsFromJson(block.content)) {
        if (allowedSet.has(p)) {
          sharedSet.add(p);
        }
      }
      // Early exit if all paths found shared
      if (sharedSet.size === allowedSet.size) {
        hasMore = false;
        break;
      }
    }

    if (blocks.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  return sharedSet;
}

// ─── Main handler ───

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
    // Аутентификация
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Один adminClient на весь запрос
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Кешируем роль один раз
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      adminClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
      adminClient.rpc("has_role_v2", { _user_id: user.id, _role_code: "superadmin" }),
    ]);
    const isAdminOrSuper = !!(isAdmin || isSuper);

    const body: DeleteRequest = await req.json();
    const { mode, paths, reason, entity } = body;

    // Валидация входных данных
    if (!mode || !["dry_run", "execute"].includes(mode)) {
      return new Response(
        JSON.stringify({ error: "Invalid mode: must be 'dry_run' or 'execute'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!Array.isArray(paths)) {
      return new Response(
        JSON.stringify({ error: "paths must be an array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (paths.length > MAX_PATHS_PER_BATCH) {
      return new Response(
        JSON.stringify({ error: `Too many paths: max ${MAX_PATHS_PER_BATCH} per call` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!reason || typeof reason !== "string") {
      return new Response(
        JSON.stringify({ error: "reason is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── DB-ownership guard: build allowed set from DB for lesson entities ───
    let dbAllowedSet: Set<string> | null = null;
    const lessonId = entity?.type === "lesson" ? entity?.id : undefined;

    if (lessonId) {
      dbAllowedSet = await buildDbAllowedSet(adminClient, lessonId);
    }

    // ─── Фильтрация путей ───
    const allowedPaths: string[] = [];
    const blockedPaths: string[] = [];

    for (const rawPath of paths) {
      // Нормализуем путь перед всеми проверками
      const path = normalizeToStoragePath(rawPath) ?? rawPath;

      // Basic guards: prefix + traversal (только по нормализованному)
      if (!isPathAllowed(path)) {
        blockedPaths.push(rawPath);
        continue;
      }

      // DB-ownership guard for lesson-* paths
      if (dbAllowedSet && LESSON_PREFIXES.some((p) => path.startsWith(p))) {
        if (!dbAllowedSet.has(path)) {
          blockedPaths.push(rawPath);
          continue;
        }
      }

      // Owner/admin check для student-uploads
      if (path.startsWith("student-uploads/")) {
        const segments = path.split("/");
        if (segments.length < 5 || segments.some(s => s === "")) {
          blockedPaths.push(rawPath);
          continue;
        }
        const pathUserId = segments[1];
        if (user.id !== pathUserId && !isAdminOrSuper) {
          blockedPaths.push(rawPath);
          continue;
        }
        // For lesson entities, also check DB-ownership for student-uploads
        if (dbAllowedSet && !dbAllowedSet.has(path)) {
          blockedPaths.push(rawPath);
          continue;
        }
      }

      allowedPaths.push(path); // нормализованный путь для remove()
    }

    // ─── Shared asset guard ───
    let sharedSet = new Set<string>();
    let sharedPaths: string[] = [];

    if (lessonId && allowedPaths.length > 0) {
      sharedSet = await findSharedPaths(adminClient, lessonId, allowedPaths);
      sharedPaths = allowedPaths.filter(p => sharedSet.has(p));
    }

    const finalDeletePaths = allowedPaths.filter(p => !sharedSet.has(p));

    if (mode === "dry_run") {
      return new Response(
        JSON.stringify({
          mode: "dry_run",
          requested_paths_count: paths.length,
          allowed_count: allowedPaths.length,
          blocked_count: blockedPaths.length,
          would_delete: finalDeletePaths,
          blocked_paths: blockedPaths,
          shared_paths: sharedPaths,
          skipped_shared_count: sharedPaths.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // mode === "execute"
    if (finalDeletePaths.length === 0) {
      const message = sharedPaths.length > 0
        ? "All paths shared with other lessons — nothing deleted"
        : "No paths passed guards — nothing deleted";
      return new Response(
        JSON.stringify({
          mode: "execute",
          requested_paths_count: paths.length,
          attempted_delete_count: 0,
          deleted_count: 0,
          blocked_count: blockedPaths.length,
          deleted_paths: [],
          blocked_paths: blockedPaths,
          shared_paths: sharedPaths,
          skipped_shared_count: sharedPaths.length,
          errors: [],
          message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Удаление ТОЛЬКО finalDeletePaths (без shared)
    const { data: removeData, error: removeError } = await adminClient.storage
      .from("training-assets")
      .remove(finalDeletePaths);

    const deletedCount = removeData?.length ?? 0;
    const errors: string[] = [];
    if (removeError) {
      errors.push(removeError.message);
    }

    // Audit log — SYSTEM ACTOR, no PII
    await adminClient.from("audit_logs").insert({
      action: "training_assets_deleted",
      actor_type: "system",
      actor_user_id: null,
      actor_label: "training-assets-delete edge function",
      meta: {
        requested_paths_count: paths.length,
        allowed_count: allowedPaths.length,
        blocked_count: blockedPaths.length,
        shared_count: sharedPaths.length,
        deleted_count: deletedCount,
        errors,
        reason,
        entity: entity || null,
        initiated_by_user_id: user.id,
      },
    });

    return new Response(
      JSON.stringify({
        mode: "execute",
        requested_paths_count: paths.length,
        attempted_delete_count: finalDeletePaths.length,
        deleted_count: deletedCount,
        blocked_count: blockedPaths.length,
        deleted_paths: finalDeletePaths,
        blocked_paths: blockedPaths,
        shared_paths: sharedPaths,
        skipped_shared_count: sharedPaths.length,
        errors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error in training-assets-delete:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
