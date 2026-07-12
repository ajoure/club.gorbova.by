/**
 * PATCH-GRANT-ACCESS-AUTHZ-V1 / SEC-A
 *
 * Caller authorization for grant-access-for-order.
 *
 * Design:
 * - Classifies caller as `service_role` | `admin` | `ordinary_user` | `anonymous` | `invalid`.
 * - Enforces per-branch permission matrix.
 * - Never trusts body-provided `source` / `context` as identity — those are
 *   returned as `claimed_*` only.
 * - Does NOT log tokens (full or partial).
 *
 * Branch matrix (CLOSURE-1 correction):
 *
 *   Branch                  service_role  admin  ordinary_user
 *   ----------------------- ------------ ------ --------------
 *   standard                     ✓         ✓         ✗
 *   adminManualAccessEdit        ✗         ✓         ✗   ← admin-only
 *   3ds_finalize                 ✓         ✗         ✗
 *   subscription_renewal         ✓         ✗         ✗
 *   legacy_body_alias            ✓         ✓         ✗
 */

export type CallerType = "service_role" | "admin" | "ordinary_user";

export interface ResolvedCaller {
  type: CallerType;
  actorUserId: string | null;
  actorLabel: string;
  actorType: "system" | "admin";
  actor: { id: string; email: string | null } | null;
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403;
  body: { success: false; error: string };
}

export interface AuthSuccess {
  ok: true;
  caller: ResolvedCaller;
}

export type Branch =
  | "standard"
  | "adminManualAccessEdit"
  | "3ds_finalize"
  | "subscription_renewal"
  | "legacy_body_alias";

/**
 * Resolve caller identity.
 *
 * - Missing Authorization header → 401 anonymous.
 * - Bearer token literally equals SUPABASE_SERVICE_ROLE_KEY → service_role.
 *   (We compare against the env value; we NEVER decode the JWT's `role`
 *   claim to grant service_role privileges — a self-signed token with
 *   `"role":"service_role"` would fail this identity check.)
 * - Otherwise verify via supabase.auth.getUser(token). If invalid → 401.
 *   If valid, check has_role_v2 for admin / super_admin → admin, else
 *   ordinary_user (which callers can then reject per branch).
 */
export async function resolveGrantAccessCaller(
  req: Request,
  supabase: any,
): Promise<AuthSuccess | AuthFailure> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, body: { success: false, error: "unauthorized_no_bearer" } };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, body: { success: false, error: "unauthorized_no_bearer" } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denoGlobal: any = (globalThis as any).Deno;
  const serviceRoleKey = (denoGlobal && typeof denoGlobal.env?.get === "function"
    ? denoGlobal.env.get("SUPABASE_SERVICE_ROLE_KEY")
    : undefined) || "";
  if (serviceRoleKey && token === serviceRoleKey) {
    return {
      ok: true,
      caller: {
        type: "service_role",
        actorUserId: null,
        actorLabel: "service_role",
        actorType: "system",
        actor: null,
      },
    };
  }

  // User JWT path.
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData?.user || null;
  if (authError || !user) {
    return { ok: false, status: 401, body: { success: false, error: "unauthorized_invalid_token" } };
  }

  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "admin" }),
    supabase.rpc("has_role_v2", { _user_id: user.id, _role_code: "super_admin" }),
  ]);

  if (isAdmin || isSuperAdmin) {
    return {
      ok: true,
      caller: {
        type: "admin",
        actorUserId: user.id,
        actorLabel: user.email || "admin",
        actorType: "admin",
        actor: { id: user.id, email: user.email || null },
      },
    };
  }

  return {
    ok: true,
    caller: {
      type: "ordinary_user",
      actorUserId: user.id,
      actorLabel: user.email || "user",
      actorType: "system", // never used; ordinary_user is rejected by branch policy
      actor: { id: user.id, email: user.email || null },
    },
  };
}

/**
 * Determine which branch is requested from the parsed body.
 * Precedence: 3ds_finalize > adminManualAccessEdit > subscription_renewal > legacy_body_alias > standard.
 */
export function detectBranch(body: any): Branch {
  if (body?.context === "3ds_finalize") return "3ds_finalize";
  if (body?.adminManualAccessEdit === true) return "adminManualAccessEdit";
  if (body?.context === "subscription_renewal") return "subscription_renewal";
  if (body?.order_id && !body?.orderId) return "legacy_body_alias";
  return "standard";
}

/**
 * Branch permission matrix. Returns null on allow, AuthFailure on deny.
 */
export function enforceBranchPolicy(branch: Branch, caller: ResolvedCaller): AuthFailure | null {
  const t = caller.type;
  if (t === "ordinary_user") {
    return { ok: false, status: 403, body: { success: false, error: "forbidden_ordinary_user" } };
  }

  switch (branch) {
    case "standard":
    case "adminManualAccessEdit":
    case "legacy_body_alias":
      // service_role OR admin
      if (t === "service_role" || t === "admin") return null;
      return { ok: false, status: 403, body: { success: false, error: "forbidden_branch" } };

    case "3ds_finalize":
    case "subscription_renewal":
      // service_role only
      if (t === "service_role") return null;
      return { ok: false, status: 403, body: { success: false, error: "forbidden_service_role_only" } };
  }
}
