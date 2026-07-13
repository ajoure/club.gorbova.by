// Stage 4 — E2E admin fixture provisioner.
// Idempotent: creates or ensures a single hard-coded fixture user with role='admin'.
// Not usable to create arbitrary admins: email is hard-coded, password is read from
// server-side env (never accepted from the request body).
//
// Safe to expose (anon-callable). Every call re-derives the same fixture user.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const FIXTURE_EMAIL_ENV = Deno.env.get("E2E_ADMIN_EMAIL") ?? "";
const FIXTURE_PASSWORD_ENV = Deno.env.get("E2E_ADMIN_PASSWORD") ?? "";
const REQUIRED_EMAIL = "stage4-playwright-admin@fixture.local";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-e2e-runner-secret",
  "Content-Type": "application/json",
};

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth gate: only callers holding the shared runner secret may provision
    // the fixture admin. Hard-coded email + server-side password remain a
    // defense-in-depth layer, but the secret is the real access control.
    const expected = Deno.env.get("E2E_RUNNER_SECRET") ?? "";
    const provided = req.headers.get("x-e2e-runner-secret") ?? "";
    if (!expected || expected.length < 16 || !constantTimeEq(expected, provided)) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: corsHeaders }
      );
    }

    if (FIXTURE_EMAIL_ENV !== REQUIRED_EMAIL) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "email_env_mismatch",
          detail:
            "E2E_ADMIN_EMAIL must equal stage4-playwright-admin@fixture.local",
        }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (!FIXTURE_PASSWORD_ENV || FIXTURE_PASSWORD_ENV.length < 16) {
      return new Response(
        JSON.stringify({ ok: false, error: "password_env_missing" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 1. Look up existing user by email (paginated listUsers).
    let existingUser: any = null;
    let page = 1;
    while (page <= 20) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw error;
      const found = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === REQUIRED_EMAIL
      );
      if (found) {
        existingUser = found;
        break;
      }
      if (data.users.length < 200) break;
      page++;
    }

    let userId: string;
    let created = false;
    if (existingUser) {
      // Refresh password so the current secret value always matches the auth user.
      const { error: updErr } = await admin.auth.admin.updateUserById(
        existingUser.id,
        {
          password: FIXTURE_PASSWORD_ENV,
          email_confirm: true,
          user_metadata: {
            fixture: "stage4_playwright",
            env: "test",
            purpose: "e2e_admin",
          },
        }
      );
      if (updErr) throw updErr;
      userId = existingUser.id;
    } else {
      const { data: cr, error: crErr } = await admin.auth.admin.createUser({
        email: REQUIRED_EMAIL,
        password: FIXTURE_PASSWORD_ENV,
        email_confirm: true,
        user_metadata: {
          fixture: "stage4_playwright",
          env: "test",
          purpose: "e2e_admin",
        },
      });
      if (crErr) throw crErr;
      userId = cr.user!.id;
      created = true;
    }

    // 2. Ensure profile row exists (lookup by user_id since some deployments
    //    use user_id as the FK and id as a separate PK).
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, user_id, is_archived, meta")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existingProfile) {
      const { error: pErr } = await admin.from("profiles").insert({
        user_id: userId,
        email: REQUIRED_EMAIL,
        first_name: "Stage4",
        last_name: "PlaywrightAdmin",
        is_archived: true,
        meta: {
          fixture: "stage4_playwright",
          env: "test",
          purpose: "e2e_admin",
        },
      });
      if (pErr && !String(pErr.message).includes("duplicate")) throw pErr;
    } else {
      const { error: pErr } = await admin
        .from("profiles")
        .update({
          is_archived: true,
          meta: {
            ...((existingProfile.meta as any) ?? {}),
            fixture: "stage4_playwright",
            env: "test",
            purpose: "e2e_admin",
          },
        })
        .eq("user_id", userId);
      if (pErr) throw pErr;
    }

    // 3. Ensure user_roles.role='admin' (never superadmin).
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("id, role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      const { error: rErr } = await admin.from("user_roles").insert({
        user_id: userId,
        role: "admin",
      });
      if (rErr && !String(rErr.message).includes("duplicate")) throw rErr;
    }

    // 4. Also grant via v2 (RLS uses has_role_v2 → user_roles_v2).
    const { data: adminRoleV2 } = await admin
      .from("roles")
      .select("id")
      .eq("code", "admin")
      .maybeSingle();
    if (adminRoleV2?.id) {
      const { data: rv2 } = await admin
        .from("user_roles_v2")
        .select("id")
        .eq("user_id", userId)
        .eq("role_id", adminRoleV2.id)
        .maybeSingle();
      if (!rv2) {
        const { error: rvErr } = await admin.from("user_roles_v2").insert({
          user_id: userId,
          role_id: adminRoleV2.id,
        });
        if (rvErr && !String(rvErr.message).includes("duplicate")) throw rvErr;
      }
    }

    // Never leak the password. Only report identity.
    return new Response(
      JSON.stringify({
        ok: true,
        created,
        user_id: userId,
        email: REQUIRED_EMAIL,
        role: "admin",
        fixture_tag: "stage4_playwright",
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e: any) {
    console.error("[admin-provision-e2e-fixture]", e);
    return new Response(
      JSON.stringify({ ok: false, error: "unhandled", detail: String(e?.message ?? e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
