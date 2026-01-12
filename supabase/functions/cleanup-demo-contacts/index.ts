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
  status: "success" | "error" | "dry-run" | "STOP";
  mode: string;
  safeguard: SafeguardCounts;
  stop_reason?: string;
  demo_profiles_count: number;
  counts: CleanupCounts;
  sample_profiles: Array<{ id: string; email: string | null; created_at?: string }>;
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

    const demoProfiles: DemoProfile[] = (demoProfilesRaw || []).map((p: any) => ({
      profile_id: p.profile_id,
      auth_user_id: p.auth_user_id,
      email: p.email,
    }));

    const demoProfileIds = demoProfiles.map(p => p.profile_id);
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

    if (demoProfileIds.length === 0) {
      // No demo profiles found
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

    // STEP 2: Check B0 safeguard FIRST (critical - before any deletions)
    const { count: ordersCount } = await supabaseAdmin
      .from("orders_v2")
      .select("*", { count: "exact", head: true })
      .in("profile_id", demoProfileIds);

    const { count: paymentsCount } = await supabaseAdmin
      .from("payments_v2")
      .select("*", { count: "exact", head: true })
      .in("profile_id", demoProfileIds);

    const { count: nonRevokedEntitlements } = await supabaseAdmin
      .from("entitlements")
      .select("*", { count: "exact", head: true })
      .in("profile_id", demoProfileIds)
      .neq("status", "revoked");

    result.safeguard = {
      orders: ordersCount || 0,
      payments: paymentsCount || 0,
      entitlements_nonrevoked: nonRevokedEntitlements || 0,
    };

    // STEP 3: STOP if any safeguard count > 0
    if ((ordersCount || 0) > 0 || (paymentsCount || 0) > 0 || (nonRevokedEntitlements || 0) > 0) {
      result.status = "STOP";
      result.stop_reason = `Предохранитель не пройден: orders=${ordersCount}, payments=${paymentsCount}, entitlements_nonrevoked=${nonRevokedEntitlements}`;
      
      // Write audit log for STOP
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

    // STEP 4: Count records to be deleted for dry-run (all tables)
    if (demoUserIds.length > 0) {
      const { count: tokensCount } = await supabaseAdmin
        .from("telegram_link_tokens")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.telegram_link_tokens = tokensCount || 0;

      const { count: grantsCount } = await supabaseAdmin
        .from("telegram_access_grants")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.telegram_access_grants = grantsCount || 0;

      const { count: accessCount } = await supabaseAdmin
        .from("telegram_access")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.telegram_access = accessCount || 0;

      const { count: notificationsCount } = await supabaseAdmin
        .from("pending_telegram_notifications")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.pending_telegram_notifications = notificationsCount || 0;

      const { count: rolesCount } = await supabaseAdmin
        .from("user_roles_v2")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.user_roles_v2 = rolesCount || 0;

      const { count: consentCount } = await supabaseAdmin
        .from("consent_logs")
        .select("*", { count: "exact", head: true })
        .in("user_id", demoUserIds);
      result.counts.consent_logs = consentCount || 0;
    }

    const { count: membersCount } = await supabaseAdmin
      .from("telegram_club_members")
      .select("*", { count: "exact", head: true })
      .in("profile_id", demoProfileIds);
    result.counts.telegram_club_members = membersCount || 0;

    // Count entitlements (only revoked with no valid order)
    const { data: revokedEntitlements } = await supabaseAdmin
      .from("entitlements")
      .select("id, order_id")
      .in("profile_id", demoProfileIds)
      .eq("status", "revoked");

    // Filter only those with null or invalid order_id
    const { data: validOrders } = await supabaseAdmin
      .from("orders_v2")
      .select("id");
    const validOrderIds = new Set((validOrders || []).map(o => o.id));
    
    const entitlementsToDelete = (revokedEntitlements || []).filter(
      e => !e.order_id || !validOrderIds.has(e.order_id)
    );
    result.counts.entitlements = entitlementsToDelete.length;

    result.counts.profiles = demoProfileIds.length;
    result.counts.auth_users = demoUserIds.length;

    // STEP 5: Execute deletions if mode is execute
    if (mode === "execute") {
      // Delete in cascade order using collected IDs

      // 1. telegram_link_tokens
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("telegram_link_tokens")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 2. telegram_access_grants
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("telegram_access_grants")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 3. telegram_access
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("telegram_access")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 4. telegram_club_members
      await supabaseAdmin
        .from("telegram_club_members")
        .delete()
        .in("profile_id", demoProfileIds);

      // 5. pending_telegram_notifications
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("pending_telegram_notifications")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 6. user_roles_v2
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("user_roles_v2")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 7. consent_logs
      if (demoUserIds.length > 0) {
        await supabaseAdmin
          .from("consent_logs")
          .delete()
          .in("user_id", demoUserIds);
      }

      // 8. entitlements (only revoked with no valid order)
      if (entitlementsToDelete.length > 0) {
        const entitlementIds = entitlementsToDelete.map(e => e.id);
        await supabaseAdmin
          .from("entitlements")
          .delete()
          .in("id", entitlementIds);
      }

      // 9. profiles
      await supabaseAdmin
        .from("profiles")
        .delete()
        .in("id", demoProfileIds);

      // 10. auth.users (via Admin API, with error handling)
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
        result.status = "success"; // Still mark as success, but include failures in response
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
