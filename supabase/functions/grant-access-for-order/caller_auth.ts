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

import type { AuthFailure, ResolvedCaller } from "../_shared/verified-financial-caller.ts";
export { resolveGrantAccessCaller } from "../_shared/verified-financial-caller.ts";
export type { CallerType, ResolvedCaller, AuthFailure, AuthSuccess } from "../_shared/verified-financial-caller.ts";

export type Branch =
  | "standard"
  | "adminManualAccessEdit"
  | "3ds_finalize"
  | "subscription_renewal"
  | "legacy_body_alias";

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
    case "legacy_body_alias":
      // service_role OR admin
      if (t === "service_role" || t === "admin") return null;
      return { ok: false, status: 403, body: { success: false, error: "forbidden_branch" } };

    case "adminManualAccessEdit":
      // admin-only (CLOSURE-1 contract correction: service_role denied here;
      // callers of this branch are frontend admin UI paths and require a
      // real admin actor for audit attribution).
      if (t === "admin") return null;
      return { ok: false, status: 403, body: { success: false, error: "forbidden_admin_only" } };

    case "3ds_finalize":
    case "subscription_renewal":
      // service_role only
      if (t === "service_role") return null;
      return { ok: false, status: 403, body: { success: false, error: "forbidden_service_role_only" } };
  }
}
