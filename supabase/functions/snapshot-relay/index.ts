// snapshot-relay — canonical human-initiated create-path for
// public.system_health_discovery_snapshots.
//
// Contract (B.1 v3):
// - verify_jwt = true (enforced in code via getClaims)
// - super_admin only (RPC has_role_v2)
// - whitelist: only op = "create_snapshot"
// - source_query MUST contain three markers and have non-empty SQL body
// - 1 snapshot = 1 finding (anti-duplication via finding_id)
// - service_role INSERT path is the explicitly allowed exception, see §0 pre-check
// - never UPDATE/DELETE snapshots (DB triggers enforce this anyway)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Required self-documentation markers in source_query.
const REQUIRED_MARKERS = [
  "source_invariant=INV-",
  "engine=nightly-system-health@sha256:",
  "finding_hypothesis=",
] as const;

// Strip SQL line-comments (-- ...) and block-comments (/* ... */),
// then check that something non-whitespace remains. This guarantees
// source_query is self-documenting AND has actual SQL body.
function hasNonCommentSqlBody(src: string): boolean {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  return noLine.trim().length > 0;
}

const BodySchema = z.object({
  op: z.literal("create_snapshot"),
  finding_id: z
    .string()
    .regex(/^F[1-9][0-9]*$/, "finding_id must match /^F[1-9][0-9]*$/"),
  source_query: z
    .string()
    .min(1)
    .max(8000)
    .refine(
      (s) => REQUIRED_MARKERS.every((m) => s.includes(m)),
      {
        message:
          "source_query must contain all required markers: " +
          REQUIRED_MARKERS.join(", "),
      },
    )
    .refine(hasNonCommentSqlBody, {
      message:
        "source_query must contain non-empty SQL body (not only comments)",
    }),
  total_rows: z.number().int().min(0),
  note: z.string().max(2000).nullish(),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // --- AuthN ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "missing_jwt" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return jsonResponse({ error: "invalid_jwt" }, 401);
  }
  const userId = claimsData.claims.sub as string;

  // --- AuthZ: super_admin only ---
  const { data: isSuper, error: roleError } = await userClient.rpc(
    "has_role_v2",
    { _user_id: userId, _role: "super_admin" },
  );
  if (roleError) {
    console.error("snapshot-relay: has_role_v2 error", roleError);
    return jsonResponse({ error: "role_check_failed" }, 500);
  }
  if (!isSuper) {
    return jsonResponse({ error: "forbidden_super_admin_required" }, 403);
  }

  // --- Input validation ---
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "invalid_payload", details: parsed.error.flatten() },
      400,
    );
  }
  const { finding_id, source_query, total_rows, note } = parsed.data;

  // --- Service-role client (explicitly allowed exception, see §0 pre-check) ---
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Anti-duplication: 1 snapshot = 1 finding ---
  const { data: existing, error: dupError } = await serviceClient
    .from("system_health_discovery_snapshots")
    .select("id, finding_id, taken_at, taken_by, total_rows, note")
    .eq("finding_id", finding_id)
    .maybeSingle();

  if (dupError) {
    console.error("snapshot-relay: dup-check error", dupError);
    return jsonResponse({ error: "dup_check_failed" }, 500);
  }
  if (existing) {
    return jsonResponse(
      {
        error: "snapshot_already_exists_for_finding",
        existing_snapshot_id: existing.id,
        finding_id: existing.finding_id,
        taken_at: existing.taken_at,
        taken_by: existing.taken_by,
        total_rows: existing.total_rows,
        note: existing.note,
      },
      409,
    );
  }

  // --- INSERT ---
  const { data: inserted, error: insertError } = await serviceClient
    .from("system_health_discovery_snapshots")
    .insert({
      finding_id,
      source_query,
      total_rows,
      note: note ?? null,
      taken_by: userId,
    })
    .select("id, finding_id, taken_at, taken_by, total_rows")
    .single();

  if (insertError || !inserted) {
    console.error("snapshot-relay: insert error", insertError);
    return jsonResponse(
      { error: "insert_failed", details: insertError?.message ?? null },
      500,
    );
  }

  console.log("snapshot-relay: created", {
    snapshot_id: inserted.id,
    finding_id: inserted.finding_id,
    taken_by: inserted.taken_by,
    total_rows: inserted.total_rows,
  });

  return jsonResponse(
    {
      ok: true,
      snapshot_id: inserted.id,
      finding_id: inserted.finding_id,
      total_rows: inserted.total_rows,
      taken_at: inserted.taken_at,
      taken_by: inserted.taken_by,
    },
    200,
  );
});
