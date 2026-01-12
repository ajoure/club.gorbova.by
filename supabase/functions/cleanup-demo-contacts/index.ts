import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DemoProfile {
  profile_id: string;
  auth_user_id: string | null;
  email: string | null;
}

interface SafeguardCounts {
  orders: number;
  payments: number;
  entitlements_nonrevoked: number;
}

interface CleanupCounts {
  telegram_link_tokens: number;
  telegram_access_grants: number;
  telegram_access: number;
  telegram_club_members: number;
  pending_telegram_notifications: number;
  user_roles_v2: number;
  consent_logs: number;
  entitlements: number;
  profiles: number;
  auth_users: number;
  auth_users_failed: number;
}

interface CleanupResult {
  status: "success" | "error" | "dry-run" | "STOP" | "PARTIAL_FAILURE";
  mode: string;
  safeguard: SafeguardCounts;
  stop_reason?: string;
  demo_profiles_count: number;
  counts: CleanupCounts;
  sample_profiles: Array<{ id: string; email: string | null }>;
  failed_auth_users?: Array<{ userId: string; error: string }>;
  audit_log_id?: string;
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get actor user from authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actorUserId = user.id;

    // Check permission: admins.manage
    const { data: hasPermission } = await supabaseAdmin.rpc("has_permission", {
      _user_id: actorUserId,
      _permission_code: "admins.manage",
    });

    if (!hasPermission) {
      return new Response(JSON.stringify({ error: "Permission denied. Requires admins.manage" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { mode = "dry-run" } = await req.json();
    const startedAt = new Date().toISOString();

    // STEP 1: Get demo profiles using SQL function (deterministic)
    const { data: demoProfilesRaw, error: demoError } = await supabaseAdmin
      .rpc("get_demo_profile_ids");

    if (demoError) {
      throw new Error(`Failed to get demo profiles: ${demoError.message}`);
    }

    const demoProfiles: DemoProfile[] = (demoProfilesRaw || []).map((p: Record<string, unknown>) => ({
      profile_id: p.profile_id as string,
      auth_user_id: p.auth_user_id as string | null,
      email: p.email as string | null,
    }));

    const demoUserIds = demoProfiles.filter(p => p.auth_user_id).map(p => p.auth_user_id!);

    const result: CleanupResult = {
      status: mode === "dry-run" ? "dry-run" : "success",
      mode,
      safeguard: { orders: 0, payments: 0, entitlements_nonrevoked: 0 },
      demo_profiles_count: demoProfiles.length,
      counts: {
        telegram_link_tokens: 0,
        telegram_access_grants: 0,
        telegram_access: 0,
        telegram_club_members: 0,
        pending_telegram_notifications: 0,
        user_roles_v2: 0,
        consent_logs: 0,
        entitlements: 0,
        profiles: 0,
        auth_users: 0,
        auth_users_failed: 0,
      },
      sample_profiles: demoProfiles.slice(0, 20).map(p => ({ id: p.profile_id, email: p.email })),
    };

    if (demoProfiles.length === 0) {
      const finishedAt = new Date().toISOString();
      const { data: auditLog } = await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: "cleanup.demo_contacts",
        target_user_id: null,
        meta: {
          mode,
          started_at: startedAt,
          finished_at: finishedAt,
          stop_reason: "No demo profiles found",
          counts: result.counts,
        },
      }).select("id").single();
      result.audit_log_id = auditLog?.id;
      result.stop_reason = "No demo profiles found";
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STEP 2: Check B0 safeguard via SQL function
    const { data: safeguardResult, error: safeguardError } = await supabaseAdmin
      .rpc("cleanup_demo_safeguard_check");

    if (safeguardError) {
      throw new Error(`Safeguard check failed: ${safeguardError.message}`);
    }

    const safeguardData = safeguardResult?.[0] || { 
      orders_count: 0, 
      payments_count: 0, 
      entitlements_nonrevoked_count: 0 
    };

    result.safeguard = {
      orders: safeguardData.orders_count || 0,
      payments: safeguardData.payments_count || 0,
      entitlements_nonrevoked: safeguardData.entitlements_nonrevoked_count || 0,
    };

    // STEP 3: STOP if any safeguard count > 0
    if (result.safeguard.orders > 0 || result.safeguard.payments > 0 || result.safeguard.entitlements_nonrevoked > 0) {
      result.status = "STOP";
      result.stop_reason = `Предохранитель не пройден: orders=${result.safeguard.orders}, payments=${result.safeguard.payments}, entitlements_nonrevoked=${result.safeguard.entitlements_nonrevoked}`;
      
      const finishedAt = new Date().toISOString();
      const { data: auditLog } = await supabaseAdmin.from("audit_logs").insert({
        actor_user_id: actorUserId,
        action: "cleanup.demo_contacts",
        target_user_id: null,
        meta: {
          mode,
          started_at: startedAt,
          finished_at: finishedAt,
          stop_reason: result.stop_reason,
          safeguard: result.safeguard,
          demo_profiles_count: result.demo_profiles_count,
          sample_profiles: result.sample_profiles,
        },
      }).select("id").single();
      result.audit_log_id = auditLog?.id;

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // STEP 4: Get counts via SQL function (for dry-run display)
    const { data: countsResult, error: countsError } = await supabaseAdmin
      .rpc("cleanup_demo_counts");

    if (countsError) {
      throw new Error(`Counts fetch failed: ${countsError.message}`);
    }

    const countsData = countsResult?.[0] || {};
    result.counts.telegram_link_tokens = countsData.telegram_link_tokens_count || 0;
    result.counts.telegram_access_grants = countsData.telegram_access_grants_count || 0;
    result.counts.telegram_access = countsData.telegram_access_count || 0;
    result.counts.telegram_club_members = countsData.telegram_club_members_count || 0;
    result.counts.pending_telegram_notifications = countsData.pending_notifications_count || 0;
    result.counts.user_roles_v2 = countsData.user_roles_count || 0;
    result.counts.consent_logs = countsData.consent_logs_count || 0;
    result.counts.profiles = countsData.profiles_count || 0;
    result.counts.auth_users = demoUserIds.length;

    // Get entitlements count via SQL function
    const { data: entitlementsResult, error: entitlementsError } = await supabaseAdmin
      .rpc("cleanup_demo_entitlements", { p_execute: false });

    if (entitlementsError) {
      throw new Error(`Entitlements count failed: ${entitlementsError.message}`);
    }

    const entitlementsData = entitlementsResult?.[0] || { deleted_count: 0 };
    result.counts.entitlements = entitlementsData.deleted_count || 0;

    // STEP 5: Execute deletions if mode is execute
    if (mode === "execute") {
      // Delete entitlements via SQL function (revoked AND order missing)
      const { error: entDeleteError } = await supabaseAdmin
        .rpc("cleanup_demo_entitlements", { p_execute: true });

      if (entDeleteError) {
        throw new Error(`Entitlements delete failed: ${entDeleteError.message}`);
      }

      // Delete all related tables via SQL function
      const { data: deleteResult, error: deleteError } = await supabaseAdmin
        .rpc("cleanup_demo_delete_all");

      if (deleteError) {
        throw new Error(`Delete all failed: ${deleteError.message}`);
      }

      const deleteData = deleteResult?.[0] || {};
      result.counts.telegram_link_tokens = deleteData.telegram_link_tokens_deleted || 0;
      result.counts.telegram_access_grants = deleteData.telegram_access_grants_deleted || 0;
      result.counts.telegram_access = deleteData.telegram_access_deleted || 0;
      result.counts.telegram_club_members = deleteData.telegram_club_members_deleted || 0;
      result.counts.pending_telegram_notifications = deleteData.pending_notifications_deleted || 0;
      result.counts.user_roles_v2 = deleteData.user_roles_deleted || 0;
      result.counts.consent_logs = deleteData.consent_logs_deleted || 0;
      result.counts.profiles = deleteData.profiles_deleted || 0;

      // Delete auth.users via Admin API (only operation that requires JS)
      const failedAuthUsers: Array<{ userId: string; error: string }> = [];
      let successAuthUsers = 0;

      for (const userId of demoUserIds) {
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (deleteError) {
          failedAuthUsers.push({ userId, error: deleteError.message });
        } else {
          successAuthUsers++;
        }
      }

      result.counts.auth_users = successAuthUsers;
      result.counts.auth_users_failed = failedAuthUsers.length;
      
      if (failedAuthUsers.length > 0) {
        result.failed_auth_users = failedAuthUsers;
        result.status = "PARTIAL_FAILURE"; // Changed from "success" to indicate partial failure
      }
    }

    // Write final audit log
    const finishedAt = new Date().toISOString();
    const { data: auditLog } = await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "cleanup.demo_contacts",
      target_user_id: null,
      meta: {
        mode,
        started_at: startedAt,
        finished_at: finishedAt,
        safeguard: result.safeguard,
        demo_profiles_count: result.demo_profiles_count,
        counts: result.counts,
        sample_profiles: result.sample_profiles,
        failed_auth_users: result.failed_auth_users || [],
        stop_reason: null,
      },
    }).select("id").single();
    result.audit_log_id = auditLog?.id;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in cleanup-demo-contacts:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage, status: "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
