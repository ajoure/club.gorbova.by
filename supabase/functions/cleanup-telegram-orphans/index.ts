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

    // ===== A1. Corruption Fix =====
    // Find records where user_id is actually a profile_id (needs correction to auth.users.id)
    // Using CTE approach via direct query
    
    // First, get corrupted records for counting/sampling
    const { data: corruptedRecords } = await supabaseAdmin
      .from("telegram_access_grants")
      .select("id, user_id")
      .not("user_id", "is", null);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id");

    const profileIdToUserId = new Map(profiles?.map(p => [p.id, p.user_id]) || []);
    
    // Corrupted = grant.user_id matches a profile.id but not an auth.users.id
    // AND the profile has a valid user_id we can correct to
    const corrupted = (corruptedRecords || []).filter(g => {
      const correctUserId = profileIdToUserId.get(g.user_id);
      return correctUserId && correctUserId !== g.user_id;
    });

    result.corruption_fixed = corrupted.length;
    result.sample_ids.corruption = corrupted.slice(0, 20).map(c => c.id);

    if (mode === "execute" && corrupted.length > 0) {
      // Execute corruption fix in batch using individual updates
      // (Supabase JS doesn't support UPDATE with CTE, but we can batch by correct user_id)
      const updatePromises = corrupted.map(async (grant) => {
        const correctUserId = profileIdToUserId.get(grant.user_id);
        if (correctUserId) {
          await supabaseAdmin
            .from("telegram_access_grants")
            .update({ user_id: correctUserId })
            .eq("id", grant.id);
        }
      });
      await Promise.all(updatePromises);
    }

    // ===== A2. Real Orphan Delete =====
    // Records where user_id doesn't exist in auth.users AND doesn't exist in profiles
    
    // Get all valid user IDs (from profiles.user_id and profiles.id)
    const { data: allProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id");

    const validUserIds = new Set<string>();
    allProfiles?.forEach(p => {
      if (p.user_id) validUserIds.add(p.user_id);
      validUserIds.add(p.id); // profile.id is also valid (for ghost profiles)
    });

    // Find orphans in telegram_access_grants
    const { data: allGrants } = await supabaseAdmin
      .from("telegram_access_grants")
      .select("id, user_id");

    const orphanGrants = (allGrants || []).filter(g => !validUserIds.has(g.user_id));

    // Find orphans in telegram_access
    const { data: allAccess } = await supabaseAdmin
      .from("telegram_access")
      .select("id, user_id");

    const orphanAccess = (allAccess || []).filter(a => !validUserIds.has(a.user_id));

    const totalOrphans = orphanGrants.length + orphanAccess.length;
    result.orphans_deleted = totalOrphans;
    result.sample_ids.orphans = [
      ...orphanGrants.slice(0, 10).map(g => `grant:${g.id}`),
      ...orphanAccess.slice(0, 10).map(a => `access:${a.id}`),
    ];

    if (mode === "execute") {
      // Delete orphans from telegram_access_grants
      if (orphanGrants.length > 0) {
        const orphanGrantIds = orphanGrants.map(g => g.id);
        await supabaseAdmin
          .from("telegram_access_grants")
          .delete()
          .in("id", orphanGrantIds);
      }

      // Delete orphans from telegram_access
      if (orphanAccess.length > 0) {
        const orphanAccessIds = orphanAccess.map(a => a.id);
        await supabaseAdmin
          .from("telegram_access")
          .delete()
          .in("id", orphanAccessIds);
      }
    }

    // ===== A3. Expired Pending Tokens =====
    // Strictly: status='pending' AND expires_at < now()
    // Plus: status='pending' AND expires_at IS NULL AND created_at < now() - 7 days
    
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

    result.expired_tokens_deleted = allExpiredTokenIds.length;
    result.sample_ids.expired_tokens = allExpiredTokenIds.slice(0, 20);

    if (mode === "execute" && allExpiredTokenIds.length > 0) {
      await supabaseAdmin
        .from("telegram_link_tokens")
        .delete()
        .in("id", allExpiredTokenIds);
    }

    // ===== Write Audit Log =====
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
