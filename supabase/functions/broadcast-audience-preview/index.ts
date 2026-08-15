import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { filterUsersByEducationCondition } from "../_shared/broadcastEducation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Требуется авторизация" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);
    const token = authHeader.slice("Bearer ".length);
    const { data: claims, error: claimsError } = await userClient.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (claimsError || !userId) return json({ error: "Сессия недействительна" }, 401);

    const [{ data: canView }, { data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      admin.rpc("has_admin_section_access", {
        _user_id: userId,
        _section_code: "communication",
        _min_level: "view",
      }),
      admin.rpc("has_role_v2", { _user_id: userId, _role_code: "admin" }),
      admin.rpc("has_role_v2", { _user_id: userId, _role_code: "super_admin" }),
    ]);
    if (!canView && !isAdmin && !isSuperAdmin) {
      return json({ error: "Недостаточно прав для просмотра аудитории рассылки" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const filters: Record<string, unknown> = body?.filters && typeof body.filters === "object" ? body.filters : {};
    // The resolver delegates to contact/user-level RPCs which only accept the
    // bypass marker when auth.uid() is NULL (service role). The marker can
    // therefore never be used to escalate a browser session directly.
    const systemFilters = { ...filters, __system_bypass: true };
    if (filters.education) {
      const { data: baseUsers, error: usersError } = await admin.rpc(
        "resolve_broadcast_audience_user_ids_system",
        { _filters: systemFilters },
      );
      if (usersError) throw usersError;
      const candidates = (baseUsers || []) as Array<{ user_id: string; has_telegram: boolean; has_email: boolean }>;
      const eligible = await filterUsersByEducationCondition(
        admin,
        candidates.map((row) => row.user_id),
        filters.education,
      );
      const selected = candidates.filter((row) => eligible.has(row.user_id));
      const userIds = selected.map((row) => row.user_id);
      const { data: profiles, error: profilesError } = userIds.length
        ? await admin
          .from("profiles")
          .select("id, user_id, full_name, email, telegram_username, telegram_user_id, is_archived, status")
          .in("user_id", userIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const activeProfiles = (profiles || []).filter((profile) => (
        filters.include_archived === true || !(profile.is_archived || profile.status === "archived")
      ));
      const telegramCount = activeProfiles.filter((profile) => profile.telegram_user_id).length;
      const emailCount = activeProfiles.filter((profile) => profile.email).length;
      return json({
        telegram_count: telegramCount,
        email_count: emailCount,
        email_active_count: emailCount,
        email_archived_count: 0,
        email_no_account_count: 0,
        total_count: new Set(activeProfiles.map((profile) => profile.user_id)).size,
        users: activeProfiles.slice(0, 100).map((profile) => ({
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          telegram_username: profile.telegram_username,
          has_telegram: Boolean(profile.telegram_user_id),
          has_email: Boolean(profile.email),
          has_account: true,
          is_archived: Boolean(profile.is_archived || profile.status === "archived"),
        })),
      });
    }

    const { data, error } = await admin.rpc("resolve_broadcast_audience", { _filters: systemFilters });
    if (error) {
      console.error("[broadcast-audience-preview] resolve failed", error.code, error.message);
      return json({ error: "Не удалось рассчитать аудиторию. Повторите попытку." }, 500);
    }
    return json(data ?? {
      telegram_count: 0,
      email_count: 0,
      email_active_count: 0,
      email_archived_count: 0,
      email_no_account_count: 0,
      total_count: 0,
      users: [],
    });
  } catch (error) {
    console.error("[broadcast-audience-preview] unexpected error", error);
    return json({ error: "Внутренняя ошибка расчёта аудитории" }, 500);
  }
});
