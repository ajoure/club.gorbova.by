/**
 * evidence-relay (A.1 v2)
 *
 * Тонкий relay для записи в system_health_discovery_findings
 * под пользовательским JWT-контекстом super_admin.
 *
 * A.0 v3.2 policy (locked):
 *   - Writes to system_health_discovery_findings allowed ONLY from super_admin user-context.
 *   - service_role writes to findings — FORBIDDEN.
 *   - Direct SQL без user JWT — FORBIDDEN.
 *
 * Эта функция НЕ нарушает политику:
 *   - НЕ использует SUPABASE_SERVICE_ROLE_KEY для записи в findings.
 *   - Создаёт supabase client с anon key + Authorization header пользователя.
 *   - Все триггеры (trg_shdf_10/20/90) и RLS-проверки в БД остаются единственным gatekeeper'ом.
 *   - Эта функция — лишь шлюз JWT → SQL, не trusted bypass.
 *
 * Whitelist операций (A.1):
 *   - insert_finding (decision принудительно = 'proposed')
 *   - update_decision
 *
 * Любая другая операция → 400.
 *
 * Изменение whitelist'а или добавление обхода — отдельный reviewed patch.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// === Schemas ===
const InsertFindingSchema = z.object({
  op: z.literal("insert_finding"),
  snapshot_id: z.string().uuid(),
  invariant_id: z.string().min(1).max(64),
  invariant_version: z.string().min(1).max(128),
  subject_type: z.string().min(1).max(64),
  subject_ref: z.string().min(1).max(256),
  evidence: z.record(z.unknown()).default({}),
  // На insert разрешён только 'proposed' (см. policy выше).
  decision: z.literal("proposed").optional().default("proposed"),
  note: z.string().max(2000).nullable().optional(),
});

const UpdateDecisionSchema = z.object({
  op: z.literal("update_decision"),
  finding_id: z.string().uuid(),
  decision: z.enum(["proposed", "exclude", "keep"]),
  note: z.string().max(2000).nullable().optional(),
});

const BodySchema = z.discriminatedUnion("op", [
  InsertFindingSchema,
  UpdateDecisionSchema,
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // === 1. JWT presence ===
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "unauthorized", reason: "missing_bearer" }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // === 2. user-scoped client (anon + user JWT). NO service_role. ===
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // === 3. Verify JWT claims (defence in depth, не замена RLS) ===
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims) {
    return jsonResponse({ error: "unauthorized", reason: "invalid_jwt" }, 401);
  }
  const claims = claimsData.claims as Record<string, unknown>;
  const userId = claims.sub as string | undefined;
  const role = claims.role as string | undefined;

  if (role !== "authenticated") {
    return jsonResponse({ error: "forbidden", reason: "role_not_authenticated" }, 403);
  }
  if (!userId) {
    return jsonResponse({ error: "unauthorized", reason: "missing_sub" }, 401);
  }

  // === 4. Defence in depth: проверяем super_admin до обращения к БД с findings ===
  // Истинная проверка всё равно произойдёт в trg_shdf_10_enforce_super_admin_*.
  const { data: hasRoleData, error: hasRoleErr } = await supabase.rpc("has_role_v2", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (hasRoleErr) {
    console.error("[evidence-relay] has_role_v2 failed:", hasRoleErr);
    return jsonResponse({ error: "internal", reason: "role_check_failed" }, 500);
  }
  if (!hasRoleData) {
    return jsonResponse({ error: "forbidden", reason: "not_super_admin" }, 403);
  }

  // === 5. Parse body ===
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request", reason: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse(
      { error: "bad_request", reason: "schema_validation_failed", details: parsed.error.flatten() },
      400,
    );
  }
  const body = parsed.data;

  // === 6. Dispatch ===
  try {
    if (body.op === "insert_finding") {
      const { data, error } = await supabase
        .from("system_health_discovery_findings")
        .insert({
          snapshot_id: body.snapshot_id,
          invariant_id: body.invariant_id,
          invariant_version: body.invariant_version,
          subject_type: body.subject_type,
          subject_ref: body.subject_ref,
          evidence: body.evidence,
          decision: "proposed", // принудительно
          note: body.note ?? null,
        })
        .select("id")
        .single();

      if (error) {
        console.error("[evidence-relay] insert_finding failed:", error);
        return jsonResponse(
          { error: "db_error", reason: error.message, code: error.code },
          400,
        );
      }
      return jsonResponse({ ok: true, finding_id: data.id });
    }

    if (body.op === "update_decision") {
      const { data, error } = await supabase
        .from("system_health_discovery_findings")
        .update({
          decision: body.decision,
          note: body.note ?? null,
        })
        .eq("id", body.finding_id)
        .select("id, decision, decided_by, decided_at, updated_at")
        .single();

      if (error) {
        console.error("[evidence-relay] update_decision failed:", error);
        return jsonResponse(
          { error: "db_error", reason: error.message, code: error.code },
          400,
        );
      }
      return jsonResponse({
        ok: true,
        finding_id: data.id,
        decision: data.decision,
        decided_by: data.decided_by,
        decided_at: data.decided_at,
        updated_at: data.updated_at,
      });
    }

    // Должно быть недостижимо благодаря discriminatedUnion.
    return jsonResponse({ error: "bad_request", reason: "unknown_op" }, 400);
  } catch (e) {
    console.error("[evidence-relay] unexpected error:", e);
    return jsonResponse({ error: "internal", reason: String(e) }, 500);
  }
});
