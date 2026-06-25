// QA test-session helper — RBAC v3 support proof.
// GUARDED: only super_admin can call; only qa.*@gorbova.test target users;
// only when public.app_settings.qa_test_helper_enabled = true (kill-switch).
//
// Actions:
//   - rotate_password { target_email }  -> { ok, password }   (one-shot random pwd)
//   - status                            -> { enabled, target_allowlist }
//
// SECURITY:
//   * verify_jwt forced via in-code getClaims().
//   * Caller MUST have role super_admin (has_role_v2).
//   * Target email MUST match /^qa\.[a-z0-9_.-]+@gorbova\.test$/i.
//   * Writes audit_logs row for every rotation.
//   * Function is deleted after proof run (see PATCH cleanup).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const QA_ALLOWLIST = /^qa\.[a-z0-9_.\-]+@gorbova\.test$/i;

function genPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return "Qa!" + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 0. Kill-switch
    const { data: flag } = await admin
      .from("app_settings").select("value").eq("key", "qa_test_helper_enabled").maybeSingle();
    const enabled = flag?.value === true || (flag?.value as any) === "true";
    if (!enabled) return json({ error: "helper_disabled" }, 403);

    // 1. Verify caller JWT
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    // 2. Caller must be super_admin
    const { data: isSuper } = await admin.rpc("has_role_v2", { _user_id: callerId, _role_code: "super_admin" });
    if (!isSuper) return json({ error: "forbidden_not_super_admin" }, 403);

    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = body.action ?? new URL(req.url).searchParams.get("action") ?? "status";

    if (action === "status") {
      return json({ enabled, target_allowlist: "qa.*@gorbova.test" });
    }

    if (action === "rotate_password") {
      const target = String(body.target_email ?? "").trim().toLowerCase();
      if (!QA_ALLOWLIST.test(target)) {
        return json({ error: "target_not_in_allowlist", target }, 400);
      }
      const { data: user, error: uErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (uErr) return json({ error: "lookup_failed", details: uErr.message }, 500);
      const found = user.users.find(u => (u.email ?? "").toLowerCase() === target);
      if (!found) return json({ error: "target_not_found" }, 404);

      const newPwd = genPassword();
      const { error: updErr } = await admin.auth.admin.updateUserById(found.id, { password: newPwd });
      if (updErr) return json({ error: "rotate_failed", details: updErr.message }, 500);

      await admin.from("audit_logs").insert({
        action: "rbac_v3.qa_helper.rotate_password",
        actor_user_id: callerId,
        entity_type: "auth.users",
        entity_id: found.id,
        meta: { target_email: target, helper: "qa-test-session-helper" },
      });

      return json({ ok: true, target_email: target, password: newPwd });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "internal", details: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
