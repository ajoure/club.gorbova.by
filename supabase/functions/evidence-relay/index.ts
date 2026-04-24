/**
 * evidence-relay (A.1 v3.1 — canonical α: hypothesis-as-filter)
 *
 * Тонкий шлюз JWT → SQL для system_health_discovery_findings.
 *
 * A.0 v3.2 policy (locked):
 *   - Writes to findings ONLY from super_admin user-context.
 *   - service_role writes to findings — FORBIDDEN.
 *   - Direct SQL без user JWT — FORBIDDEN.
 *
 * Эта функция:
 *   - НЕ использует SUPABASE_SERVICE_ROLE_KEY.
 *   - Создаёт client с anon key + Authorization: Bearer <user_jwt>.
 *   - Триггеры (trg_shdf_10/20/90) и RLS — единственный gatekeeper.
 *
 * Whitelist:
 *   - insert_finding (decision принудительно = 'proposed')
 *   - update_decision (decision: 'exclude' | 'keep' | 'manual_review')
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const InsertFindingSchema = z.object({
  op: z.literal("insert_finding"),
  finding_id: z.string().regex(/^F[1-9][0-9]*$/, "finding_id must match ^F[1-9][0-9]*$"),
  snapshot_id: z.string().uuid(),
  field: z.string().min(1).max(128),
  value: z.string().min(1).max(512),
  match_count: z.number().int().nonnegative(),
  total_in_finding: z.number().int().nonnegative(),
  coverage_pct: z.number().min(0).max(100).optional(),
  evidence_query: z.string().min(1).max(8000),
  note: z.string().max(2000).nullable().optional(),
});

const UpdateDecisionSchema = z.object({
  op: z.literal("update_decision"),
  finding_row_id: z.string().uuid(),
  decision: z.enum(["exclude", "keep", "manual_review"]),
  note: z.string().max(2000).nullable().optional(),
});

const BodySchema = z.discriminatedUnion("op", [InsertFindingSchema, UpdateDecisionSchema]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "unauthorized", reason: "missing_bearer" }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(jwt);
  if (claimsErr || !claimsData?.claims) {
    return jsonResponse({ error: "unauthorized", reason: "invalid_jwt" }, 401);
  }
  const claims = claimsData.claims as Record<string, unknown>;
  const userId = claims.sub as string | undefined;
  const role = claims.role as string | undefined;

  if (role !== "authenticated" || !userId) {
    return jsonResponse({ error: "unauthorized", reason: "bad_claims" }, 401);
  }

  // Defence in depth — БД-триггер всё равно проверит. Используем is_super_admin(uuid)
  // — однозначная сигнатура без overload-конфликтов.
  const { data: isSuperAdmin, error: roleErr } = await supabase.rpc("is_super_admin", {
    _user_id: userId,
  });
  if (roleErr) {
    console.error("[evidence-relay] is_super_admin failed:", roleErr);
    return jsonResponse({ error: "internal", reason: "role_check_failed" }, 500);
  }
  if (!isSuperAdmin) {
    return jsonResponse({ error: "forbidden", reason: "not_super_admin" }, 403);
  }

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

  try {
    if (body.op === "insert_finding") {
      const coverage =
        body.coverage_pct ??
        (body.total_in_finding > 0
          ? Math.round((body.match_count / body.total_in_finding) * 10000) / 100
          : 0);

      const { data, error } = await supabase
        .from("system_health_discovery_findings")
        .insert({
          finding_id: body.finding_id,
          snapshot_id: body.snapshot_id,
          field: body.field,
          value: body.value,
          match_count: body.match_count,
          total_in_finding: body.total_in_finding,
          coverage_pct: coverage,
          decision: "proposed",
          evidence_query: body.evidence_query,
          note: body.note ?? null,
        })
        .select("id, finding_id, decision, created_by, updated_by, created_at")
        .single();

      if (error) {
        console.error("[evidence-relay] insert_finding failed:", error);
        return jsonResponse(
          { error: "db_error", reason: error.message, code: error.code },
          400,
        );
      }
      return jsonResponse({ ok: true, ...data });
    }

    if (body.op === "update_decision") {
      const { data, error } = await supabase
        .from("system_health_discovery_findings")
        .update({
          decision: body.decision,
          note: body.note ?? null,
        })
        .eq("id", body.finding_row_id)
        .select("id, finding_id, decision, decided_by, decided_at, updated_by, updated_at")
        .single();

      if (error) {
        console.error("[evidence-relay] update_decision failed:", error);
        return jsonResponse(
          { error: "db_error", reason: error.message, code: error.code },
          400,
        );
      }
      return jsonResponse({ ok: true, ...data });
    }

    return jsonResponse({ error: "bad_request", reason: "unknown_op" }, 400);
  } catch (e) {
    console.error("[evidence-relay] unexpected error:", e);
    return jsonResponse({ error: "internal", reason: String(e) }, 500);
  }
});
