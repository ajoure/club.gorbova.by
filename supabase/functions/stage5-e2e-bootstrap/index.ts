// Stage 5 E2E bootstrap — TEMPORARY.
// Ограничения (жёсткие):
//   verify_jwt = false
//   X-E2E-Runner-Secret обязателен (constant-time compare)
//   hard-coded fixture user_id/email
//   никаких входных user_id/email/role
//   никакого возврата JWT, никакого возврата пароля
//   действия: bootstrap { password } | teardown { role_row_ids[] }
// После прогона: undeploy + удалить STAGE5_E2E_RUNNER_SECRET + удалить каталог.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-e2e-runner-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIXTURE_USER_ID = "dcfb8ea4-bf4a-47a6-a2fb-c3f285031869";
const FIXTURE_EMAIL = "stage4-playwright-admin@fixture.local";
const ADMIN_ROLE_ID = "16c9cefc-60a3-4edd-a421-46d556e80257"; // roles.code='admin'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const runnerSecret = Deno.env.get("STAGE5_E2E_RUNNER_SECRET") ?? "";
  const provided = req.headers.get("x-e2e-runner-secret") ?? "";
  if (!runnerSecret || !provided || !timingSafeEqual(runnerSecret, provided)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action?: string; password?: string; role_row_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  if (body.action === "bootstrap") {
    const password = body.password;
    if (typeof password !== "string" || password.length < 24) {
      return new Response(JSON.stringify({ error: "weak_password" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // 1. Reset password on fixture user (hard-coded id, no input).
    const upd = await admin.auth.admin.updateUserById(FIXTURE_USER_ID, {
      password,
      email_confirm: true,
    });
    if (upd.error || upd.data.user?.email !== FIXTURE_EMAIL) {
      console.error("bootstrap update_failed", {
        err: upd.error?.message,
        gotEmail: upd.data?.user?.email,
      });
      return new Response(JSON.stringify({ error: "update_failed", detail: upd.error?.message ?? null, gotEmail: upd.data?.user?.email ?? null }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Insert admin role row (idempotent via unique(user_id, role_id)).
    const ins = await admin
      .from("user_roles_v2")
      .upsert(
        { user_id: FIXTURE_USER_ID, role_id: ADMIN_ROLE_ID },
        { onConflict: "user_id,role_id" },
      )
      .select("id")
      .single();
    if (ins.error || !ins.data?.id) {
      return new Response(JSON.stringify({ error: "role_insert_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ ok: true, role_row_id: ins.data.id, user_id: FIXTURE_USER_ID, email: FIXTURE_EMAIL }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (body.action === "teardown") {
    const ids = Array.isArray(body.role_row_ids) ? body.role_row_ids.filter((x) => typeof x === "string") : [];
    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: "no_role_row_ids" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Delete only rows that (a) match given IDs AND (b) belong to fixture user AND (c) admin role.
    const del = await admin
      .from("user_roles_v2")
      .delete()
      .in("id", ids)
      .eq("user_id", FIXTURE_USER_ID)
      .eq("role_id", ADMIN_ROLE_ID)
      .select("id");
    if (del.error) {
      return new Response(JSON.stringify({ error: "delete_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, deleted: del.data?.map((r) => r.id) ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unknown_action" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
