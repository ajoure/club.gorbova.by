import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CleanupResult {
  status: "success" | "error" | "dry-run";
  mode: string;
  corruption_fixed: number;
  orphans_deleted: number;
  expired_tokens_deleted: number;
  sample_ids: {
    corruption: string[];
    orphans: string[];
    expired_tokens: string[];
  };
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

    const result: CleanupResult = {
      status: mode === "dry-run" ? "dry-run" : "success",
      mode,
      corruption_fixed: 0,
      orphans_deleted: 0,
      expired_tokens_deleted: 0,
      sample_ids: {
        corruption: [],
        orphans: [],
        expired_tokens: [],
      },
    };

    // A1. Corruption Fix: Find records where user_id is actually a profile_id
    // These need to be updated to the correct auth.users.id
    // Note: We'll use direct queries instead of raw SQL RPC

    // Use direct query approach to find corrupted records
    const corruptedIds: string[] = [];
    // Get telegram_access_grants and profiles to find corrupted records
    const { data: grants } = await supabaseAdmin
      .from("telegram_access_grants")
      .select("id, user_id");
    
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id");
    
    const profileMap = new Map(profiles?.map(p => [p.id, p.user_id]) || []);
    
    // Find grants where user_id matches a profile_id instead of auth.users.id
    const corrupted = (grants || []).filter(g => {
      const profileUserId = profileMap.get(g.user_id);
      return profileUserId && profileUserId !== g.user_id;
    });

    corrupted.forEach(c => corruptedIds.push(c.id));
    result.sample_ids.corruption = corruptedIds.slice(0, 20);
    result.corruption_fixed = corruptedIds.length;

    if (mode === "execute" && corruptedIds.length > 0) {
      // Fix each corrupted record
      for (const grant of corrupted) {
        const correctUserId = profileMap.get(grant.user_id);
        if (correctUserId) {
          await supabaseAdmin
            .from("telegram_access_grants")
            .update({ user_id: correctUserId })
            .eq("id", grant.id);
        }
      }
    }
    // A2. Real Orphan Delete: Records where user_id doesn't exist in auth.users OR profiles
    // Get all telegram_access_grants and filter orphans
    const { data: allGrants } = await supabaseAdmin
      .from("telegram_access_grants")
      .select("id, user_id");

    const { data: allProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id");

    const validUserIds = new Set<string>();
    allProfiles?.forEach(p => {
      validUserIds.add(p.id);
      if (p.user_id) validUserIds.add(p.user_id);
    });

    const orphanGrants = (allGrants || []).filter(g => !validUserIds.has(g.user_id));
    result.sample_ids.orphans = orphanGrants.slice(0, 20).map(g => g.id);

    if (mode === "execute" && orphanGrants.length > 0) {
      const orphanIds = orphanGrants.map(g => g.id);
      await supabaseAdmin
        .from("telegram_access_grants")
        .delete()
        .in("id", orphanIds);
    }
    result.orphans_deleted = orphanGrants.length;

    // Also check telegram_access table for orphans
    const { data: allAccess } = await supabaseAdmin
      .from("telegram_access")
      .select("id, user_id");

    const orphanAccess = (allAccess || []).filter(a => !validUserIds.has(a.user_id));
    
    if (mode === "execute" && orphanAccess.length > 0) {
      const orphanAccessIds = orphanAccess.map(a => a.id);
      await supabaseAdmin
        .from("telegram_access")
        .delete()
        .in("id", orphanAccessIds);
    }
    result.orphans_deleted += orphanAccess.length;

    // A3. Expired Pending Tokens - strictly as specified
    const now = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get expired tokens with expires_at
    const { data: expiredTokens1 } = await supabaseAdmin
      .from("telegram_link_tokens")
      .select("id")
      .eq("status", "pending")
      .not("expires_at", "is", null)
      .lt("expires_at", now);

    // Get old pending tokens without expires_at (older than 7 days)
    const { data: expiredTokens2 } = await supabaseAdmin
      .from("telegram_link_tokens")
      .select("id")
      .eq("status", "pending")
      .is("expires_at", null)
      .lt("created_at", sevenDaysAgo);

    const allExpiredTokenIds = [
      ...(expiredTokens1 || []).map(t => t.id),
      ...(expiredTokens2 || []).map(t => t.id),
    ];

    result.sample_ids.expired_tokens = allExpiredTokenIds.slice(0, 20);
    result.expired_tokens_deleted = allExpiredTokenIds.length;

    if (mode === "execute" && allExpiredTokenIds.length > 0) {
      await supabaseAdmin
        .from("telegram_link_tokens")
        .delete()
        .in("id", allExpiredTokenIds);
    }

    // Write audit log
    const finishedAt = new Date().toISOString();
    const { data: auditLog } = await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: actorUserId,
      action: "cleanup.telegram_orphans",
      target_user_id: null,
      meta: {
        mode,
        started_at: startedAt,
        finished_at: finishedAt,
        counts: {
          corruption_fixed: result.corruption_fixed,
          orphans_deleted: result.orphans_deleted,
          expired_tokens_deleted: result.expired_tokens_deleted,
        },
        sample_ids: result.sample_ids,
        stop_reason: null,
      },
    }).select("id").single();

    result.audit_log_id = auditLog?.id;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in cleanup-telegram-orphans:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage, status: "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
