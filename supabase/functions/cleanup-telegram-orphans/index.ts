import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CleanupResult {
  status: "success" | "error" | "dry-run";
  mode: string;
  corruption_fixed: number;
  orphans_deleted: { grants: number; access: number };
  expired_tokens_deleted: number;
  sample_ids: {
    corruption: string[];
    orphans_grants: string[];
    orphans_access: string[];
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
    const executeFlag = mode === "execute";

    // ===== A1. Corruption Fix via SQL function =====
    const { data: corruptionResult, error: corruptionError } = await supabaseAdmin
      .rpc("cleanup_telegram_corruption_fix", { p_execute: executeFlag });

    if (corruptionError) {
      throw new Error(`Corruption fix failed: ${corruptionError.message}`);
    }

    const corruptionData = corruptionResult?.[0] || { fixed_count: 0, sample_ids: [] };

    // ===== A2. Orphan Delete via SQL function =====
    const { data: orphansResult, error: orphansError } = await supabaseAdmin
      .rpc("cleanup_telegram_orphans_delete", { p_execute: executeFlag });

    if (orphansError) {
      throw new Error(`Orphans delete failed: ${orphansError.message}`);
    }

    const orphansData = orphansResult?.[0] || { 
      grants_count: 0, 
      access_count: 0, 
      grant_samples: [], 
      access_samples: [] 
    };

    // ===== A3. Expired Tokens via SQL function =====
    const { data: tokensResult, error: tokensError } = await supabaseAdmin
      .rpc("cleanup_telegram_expired_tokens", { p_execute: executeFlag });

    if (tokensError) {
      throw new Error(`Expired tokens delete failed: ${tokensError.message}`);
    }

    const tokensData = tokensResult?.[0] || { deleted_count: 0, sample_ids: [] };

    // Build result
    const result: CleanupResult = {
      status: mode === "dry-run" ? "dry-run" : "success",
      mode,
      corruption_fixed: corruptionData.fixed_count || 0,
      orphans_deleted: {
        grants: orphansData.grants_count || 0,
        access: orphansData.access_count || 0,
      },
      expired_tokens_deleted: tokensData.deleted_count || 0,
      sample_ids: {
        corruption: (corruptionData.sample_ids || []).map(String),
        orphans_grants: (orphansData.grant_samples || []).map(String),
        orphans_access: (orphansData.access_samples || []).map(String),
        expired_tokens: (tokensData.sample_ids || []).map(String),
      },
    };

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
          orphans_grants: result.orphans_deleted.grants,
          orphans_access: result.orphans_deleted.access,
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
