// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * One-off, resumable migration from legacy public training-assets/student-uploads
 * to the private student-submissions bucket. Nothing is moved without both an
 * admin JWT and the explicit execute confirmation below.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_BUCKET = "training-assets";
const TARGET_BUCKET = "student-submissions";
const PREFIX = "student-uploads/";
const PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const EXECUTE_CONFIRMATION = "MOVE_LEGACY_STUDENT_UPLOADS";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isStudentPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return false;
  if (value.includes("..") || value.includes("//") || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.length >= 5 && segments.every(Boolean);
}

function collectLegacyPaths(value: unknown, output: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectLegacyPaths(item, output));
    return;
  }
  const record = value as Record<string, unknown>;
  const bucket = record.storage_bucket;
  const path = isStudentPath(record.storage_path)
    ? record.storage_path
    : isStudentPath(record.storagePath)
      ? record.storagePath
      : null;
  if (path && bucket !== TARGET_BUCKET) output.add(path);
  Object.values(record).forEach((item) => collectLegacyPaths(item, output));
}

function markPrivateBucket(value: unknown, migrated: Set<string>): { value: unknown; changed: boolean } {
  if (!value || typeof value !== "object") return { value, changed: false };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = markPrivateBucket(item, migrated);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }

  const record = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    const result = markPrivateBucket(item, migrated);
    changed ||= result.changed;
    next[key] = result.value;
  }

  const path = isStudentPath(record.storage_path)
    ? record.storage_path
    : isStudentPath(record.storagePath)
      ? record.storagePath
      : null;
  if (path && migrated.has(path) && record.storage_bucket !== TARGET_BUCKET) {
    next.storage_bucket = TARGET_BUCKET;
    changed = true;
  }
  return { value: changed ? next : value, changed };
}

async function listAllObjects(client: any, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(SOURCE_BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`storage_list_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) result.push(fullPath);
      else result.push(...await listAllObjects(client, fullPath));
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return result;
}

async function loadProgressRows(client: any): Promise<Array<{ id: string; response: unknown }>> {
  const rows: Array<{ id: string; response: unknown }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client
      .from("user_lesson_progress")
      .select("id,response")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`progress_read_failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "unauthorized" }, 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anon.auth.getUser(authorization.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      admin.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
      admin.rpc("has_role_v2", { _user_id: user.id, _role_code: "super_admin" }),
    ]);
    if (!isAdmin && !isSuperAdmin) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "execute" ? "execute" : body.mode === "dry_run" ? "dry_run" : null;
    if (!mode) return json({ error: "mode_must_be_dry_run_or_execute" }, 400);
    if (mode === "execute" && body.confirm !== EXECUTE_CONFIRMATION) {
      return json({ error: "explicit_confirmation_required" }, 400);
    }

    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = typeof body.cursor === "string" ? body.cursor : "";
    const progressRows = await loadProgressRows(admin);
    const legacyReferences = new Set<string>();
    progressRows.forEach((row) => collectLegacyPaths(row.response, legacyReferences));

    const legacyObjects = (await listAllObjects(admin, "student-uploads"))
      .filter((path) => legacyReferences.has(path))
      .sort();
    const pending = legacyObjects.filter((path) => path > cursor);
    const selectedPaths = pending.slice(0, limit);
    const nextCursor = pending.length > selectedPaths.length ? selectedPaths.at(-1) : null;

    if (mode === "dry_run") {
      return json({
        mode,
        referenced_legacy_paths: legacyReferences.size,
        legacy_objects_found: legacyObjects.length,
        selected_count: selectedPaths.length,
        remaining_count: Math.max(0, pending.length - selectedPaths.length),
        next_cursor: nextCursor,
        execute_confirmation: EXECUTE_CONFIRMATION,
      });
    }

    const copyErrors: string[] = [];
    for (const path of selectedPaths) {
      const { data: source, error: downloadError } = await admin.storage.from(SOURCE_BUCKET).download(path);
      if (downloadError || !source) {
        copyErrors.push(`download:${path}`);
        continue;
      }
      const { error: uploadError } = await admin.storage.from(TARGET_BUCKET).upload(path, source, {
        upsert: false,
        contentType: source.type || undefined,
      });
      // A pre-existing target is safe: it is the exact idempotent retry state.
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        copyErrors.push(`upload:${path}`);
      }
    }
    if (copyErrors.length > 0) {
      return json({ error: "copy_failed_no_metadata_or_source_deleted", copy_errors: copyErrors.length }, 409);
    }

    const migrated = new Set(selectedPaths);
    let updatedProgressRows = 0;
    for (const row of progressRows) {
      const transformed = markPrivateBucket(row.response, migrated);
      if (!transformed.changed) continue;
      const { error } = await admin.from("user_lesson_progress").update({ response: transformed.value }).eq("id", row.id);
      if (error) return json({ error: "metadata_update_failed_source_not_deleted" }, 409);
      updatedProgressRows += 1;
    }

    const { error: removeError } = selectedPaths.length > 0
      ? await admin.storage.from(SOURCE_BUCKET).remove(selectedPaths)
      : { error: null };
    if (removeError) return json({ error: "source_cleanup_failed_private_copy_is_safe" }, 409);

    await admin.from("audit_logs").insert({
      action: "student_submissions_migrated_private",
      actor_type: "system",
      actor_user_id: null,
      actor_label: "admin-migrate-student-submissions edge function",
      meta: { actor_user_id: user.id, migrated_count: selectedPaths.length, updated_progress_rows: updatedProgressRows },
    });

    return json({
      mode,
      migrated_count: selectedPaths.length,
      updated_progress_rows: updatedProgressRows,
      remaining_count: Math.max(0, pending.length - selectedPaths.length),
      next_cursor: nextCursor,
    });
  } catch (error) {
    console.error("admin-migrate-student-submissions failed", error);
    return json({ error: "internal_error" }, 500);
  }
});
