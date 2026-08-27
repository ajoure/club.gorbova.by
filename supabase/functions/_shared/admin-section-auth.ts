import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

type AuthUser = {
  id: User["id"];
  email?: User["email"];
};

type AuthFailure = {
  ok: false;
  status: 401 | 403 | 500;
  error: "unauthorized" | "forbidden" | "rbac_check_failed";
};

type AuthSuccess = {
  ok: true;
  actor: AuthUser;
};

export type AdminSectionAuthResult = AuthSuccess | AuthFailure;

function bearerToken(req: Request): string | null {
  const match = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateAdminActor(
  req: Request,
  admin: SupabaseClient,
): Promise<AuthSuccess | AuthFailure> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const { data, error } = await admin.auth.getUser(token);
  const actor = data?.user as AuthUser | null | undefined;
  if (error || !actor?.id) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, actor };
}

export async function hasAdminSectionAccess(
  admin: SupabaseClient,
  actorUserId: string,
  sectionCode: string,
  minLevel: "view" | "edit" | "manage",
): Promise<{ ok: true; allowed: boolean } | AuthFailure> {
  const { data, error } = await admin.rpc("has_admin_section_access", {
    _user_id: actorUserId,
    _section_code: sectionCode,
    _min_level: minLevel,
  });
  if (error) return { ok: false, status: 500, error: "rbac_check_failed" };
  return { ok: true, allowed: data === true };
}

export async function requireAdminSectionAccess(
  req: Request,
  admin: SupabaseClient,
  sectionCode: string,
  minLevel: "view" | "edit" | "manage",
): Promise<AdminSectionAuthResult> {
  const auth = await authenticateAdminActor(req, admin);
  if (!auth.ok) return auth;

  const access = await hasAdminSectionAccess(
    admin,
    auth.actor.id,
    sectionCode,
    minLevel,
  );
  if (!access.ok) return access;
  if (!access.allowed) return { ok: false, status: 403, error: "forbidden" };
  return auth;
}

export async function requirePaymentsEdit(
  req: Request,
  admin: SupabaseClient,
): Promise<AdminSectionAuthResult> {
  return await requireAdminSectionAccess(req, admin, "payments", "edit");
}
