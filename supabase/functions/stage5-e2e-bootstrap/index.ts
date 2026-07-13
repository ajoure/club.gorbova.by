// Stage 5 E2E bootstrap — TEMPORARY.
// Ограничения (жёсткие):
//   verify_jwt = false
//   POST only (405 иначе)
//   X-E2E-Runner-Secret обязателен (constant-time compare)
//   hard-coded fixture user_id/email/role
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const runnerSecret = Deno.env.get("STAGE5_E2E_RUNNER_SECRET") ?? "";
  const provided = req.headers.get("x-e2e-runner-secret") ?? "";
  if (!runnerSecret || !provided || !timingSafeEqual(runnerSecret, provided)) {
    return json(403, { error: "forbidden" });
  }

  let body: { action?: string; password?: string; role_row_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  if (body.action === "bootstrap") {
    const password = body.password;
    if (typeof password !== "string" || password.length < 24) {
      return json(400, { error: "weak_password" });
    }

    // 1. Verify exact profile row exists and email matches.
    const prof = await admin
      .from("profiles")
      .select("id, email")
      .eq("id", FIXTURE_USER_ID)
      .maybeSingle();
    if (prof.error) {
      return json(500, { error: "profile_lookup_failed", detail: prof.error.message });
    }
    if (!prof.data || prof.data.email !== FIXTURE_EMAIL) {
      return json(409, {
        error: "fixture_profile_mismatch",
        got: prof.data ?? null,
        expected: { id: FIXTURE_USER_ID, email: FIXTURE_EMAIL },
      });
    }

    // 2. Look up existing auth user by fixture ID.
    const existing = await admin.auth.admin.getUserById(FIXTURE_USER_ID);
    const existingErrMsg = existing.error?.message ?? "";
    const isNotFound =
      !!existing.error &&
      /not.?found|user_not_found|no rows/i.test(existingErrMsg);
    const existsById = !!existing.data?.user && !existing.error;

    if (!existsById && existing.error && !isNotFound) {
      // Any non-"not found" Auth API error → fail closed, do not proceed to create.
      return json(500, { error: "get_user_failed", detail: existingErrMsg });
    }

    let createdAuthUser = false;

    // Rollback helper for created auth user on any downstream failure.
    const rollbackCreated = async () => {
      if (!createdAuthUser) return null;
      const r = await admin.auth.admin.deleteUser(FIXTURE_USER_ID);
      return r.error?.message ?? null;
    };
    const failAfterCreate = async (payload: Record<string, unknown>) => {
      const rollbackErr = await rollbackCreated();
      return json(500, rollbackErr ? { ...payload, rollback_error: rollbackErr } : payload);
    };

    if (existsById) {
      // Path A: same ID exists → email must match, then just reset password.
      if (existing.data!.user!.email !== FIXTURE_EMAIL) {
        return json(409, {
          error: "fixture_email_mismatch",
          got: existing.data!.user!.email,
          expected: FIXTURE_EMAIL,
        });
      }
      const upd = await admin.auth.admin.updateUserById(FIXTURE_USER_ID, {
        password,
        email_confirm: true,
      });
      if (upd.error) {
        return json(500, { error: "update_failed", detail: upd.error.message });
      }
    } else {
      // Path B: no auth user with FIXTURE_USER_ID.
      // Pagination-safe email collision scan (listUsers has no email filter).
      const MAX_PAGES = 100;
      const PAGE_SIZE = 200;
      let collision: { id: string } | undefined;
      let scannedComplete = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const result = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        if (result.error) {
          return json(500, { error: "list_users_failed", detail: result.error.message });
        }
        const users = result.data.users;
        collision = users.find(
          (u) => (u.email ?? "").toLowerCase() === FIXTURE_EMAIL.toLowerCase(),
        );
        if (collision) break;
        if (users.length < PAGE_SIZE) {
          scannedComplete = true;
          break;
        }
      }
      if (collision) {
        return json(409, {
          error: "fixture_email_taken",
          taken_by_user_id: collision.id,
        });
      }
      if (!scannedComplete) {
        return json(500, { error: "auth_user_scan_incomplete" });
      }

      // Path B (cont): create fixture auth user with exact ID.
      const created = await admin.auth.admin.createUser({
        id: FIXTURE_USER_ID,
        email: FIXTURE_EMAIL,
        password,
        email_confirm: true,
        user_metadata: {
          fixture: "stage5_payments_parity",
          env: "test",
          purpose: "e2e_admin",
        },
        app_metadata: {
          fixture: "stage5_payments_parity",
        },
      });
      if (created.error || !created.data?.user) {
        return json(500, { error: "create_user_failed", detail: created.error?.message ?? null });
      }
      if (
        created.data.user.id !== FIXTURE_USER_ID ||
        created.data.user.email !== FIXTURE_EMAIL
      ) {
        // Rollback: unexpected identity → delete this specific just-created user.
        await admin.auth.admin.deleteUser(created.data.user.id);
        return json(500, {
          error: "create_user_identity_mismatch",
          got: { id: created.data.user.id, email: created.data.user.email },
        });
      }
      createdAuthUser = true;
    }

    // 3. Insert admin role row — must NOT pre-exist.
    const pre = await admin
      .from("user_roles_v2")
      .select("id")
      .eq("user_id", FIXTURE_USER_ID)
      .eq("role_id", ADMIN_ROLE_ID);
    if (pre.error) {
      return failAfterCreate({ error: "role_precheck_failed", detail: pre.error.message });
    }
    if ((pre.data?.length ?? 0) !== 0) {
      return failAfterCreate({
        error: "role_already_present",
        existing_ids: (pre.data ?? []).map((r: any) => r.id),
      });
    }
    const ins = await admin
      .from("user_roles_v2")
      .insert({ user_id: FIXTURE_USER_ID, role_id: ADMIN_ROLE_ID })
      .select("id")
      .single();
    if (ins.error || !ins.data?.id) {
      return failAfterCreate({ error: "role_insert_failed", detail: ins.error?.message ?? null });
    }


    return json(200, {
      ok: true,
      created_auth_user: createdAuthUser,
      role_row_id: ins.data.id,
      user_id: FIXTURE_USER_ID,
      email: FIXTURE_EMAIL,
    });
  }

  if (body.action === "teardown") {
    const ids = Array.isArray(body.role_row_ids)
      ? body.role_row_ids.filter((x) => typeof x === "string")
      : [];
    if (ids.length === 0) return json(400, { error: "no_role_row_ids" });

    // Delete only rows that (a) match given IDs AND (b) belong to fixture user AND (c) admin role.
    const del = await admin
      .from("user_roles_v2")
      .delete()
      .in("id", ids)
      .eq("user_id", FIXTURE_USER_ID)
      .eq("role_id", ADMIN_ROLE_ID)
      .select("id");
    if (del.error) return json(500, { error: "delete_failed", detail: del.error.message });

    // Verify no admin role rows remain for fixture.
    const remain = await admin
      .from("user_roles_v2")
      .select("id", { count: "exact", head: true })
      .eq("user_id", FIXTURE_USER_ID)
      .eq("role_id", ADMIN_ROLE_ID);
    return json(200, {
      ok: true,
      deleted: del.data?.map((r) => r.id) ?? [],
      remaining_admin_rows: remain.count ?? null,
    });
  }

  return json(400, { error: "unknown_action" });
});
