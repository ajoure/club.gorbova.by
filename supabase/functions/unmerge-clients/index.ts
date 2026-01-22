/**
 * unmerge-clients: Разъединение ранее объединённых контактов
 * 
 * Восстанавливает merged профили и возвращает данные обратно
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { mergeHistoryId } = await req.json();

    if (!mergeHistoryId) {
      return new Response(JSON.stringify({ error: "Missing mergeHistoryId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[unmerge-clients] Starting unmerge for history ${mergeHistoryId}`);

    // Get merge history
    const { data: history, error: historyError } = await supabase
      .from("merge_history")
      .select("*")
      .eq("id", mergeHistoryId)
      .single();

    if (historyError || !history) {
      return new Response(JSON.stringify({ error: "Merge history not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mergedData = history.merged_data as {
      merged_profile_ids: string[];
      merged_profiles_snapshot: Array<{
        id: string;
        user_id: string | null;
        email: string | null;
        full_name: string | null;
        phone: string | null;
        telegram_user_id: number | null;
        telegram_username: string | null;
      }>;
      telegram_source_profile_id: string | null;
    };

    const masterProfileId = history.master_profile_id;
    const mergedProfileIds = mergedData.merged_profile_ids;
    const mergedProfilesSnapshot = mergedData.merged_profiles_snapshot;

    console.log(`[unmerge-clients] Master: ${masterProfileId}, Merged: ${mergedProfileIds.join(",")}`);

    // ========================================
    // Восстановить merged профили
    // ========================================
    for (const snapshot of mergedProfilesSnapshot) {
      await supabase
        .from("profiles")
        .update({
          is_archived: false,
          merged_to_profile_id: null,
          duplicate_flag: "none",
          // Восстановить Telegram данные
          telegram_user_id: snapshot.telegram_user_id,
          telegram_username: snapshot.telegram_username,
        })
        .eq("id", snapshot.id);
      
      console.log(`[unmerge-clients] Restored profile ${snapshot.id}`);
    }

    // ========================================
    // Очистить Telegram у master если был перенесён
    // ========================================
    if (mergedData.telegram_source_profile_id) {
      // Найти оригинальный telegram данные master (до merge)
      // Если telegram был перенесён - очистить у master
      await supabase
        .from("profiles")
        .update({
          telegram_user_id: null,
          telegram_username: null,
        })
        .eq("id", masterProfileId);
      
      console.log(`[unmerge-clients] Cleared telegram from master ${masterProfileId}`);
    }

    // ========================================
    // Пометить merge_history как unmerged
    // ========================================
    await supabase
      .from("merge_history")
      .update({
        merged_data: {
          ...mergedData,
          unmerged_at: new Date().toISOString(),
          unmerged_by: claimsData.claims.sub,
        },
      })
      .eq("id", mergeHistoryId);

    // ========================================
    // audit_logs: событие CONTACT_UNMERGED
    // ========================================
    const { data: masterProfile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("id", masterProfileId)
      .single();

    await supabase.from("audit_logs").insert({
      action: "CONTACT_UNMERGED",
      actor_user_id: claimsData.claims.sub,
      actor_type: "admin",
      target_user_id: masterProfile?.user_id,
      meta: {
        master_profile_id: masterProfileId,
        restored_profile_ids: mergedProfileIds,
        merge_history_id: mergeHistoryId,
      },
    });

    console.log("[unmerge-clients] Unmerge completed successfully");

    return new Response(JSON.stringify({
      success: true,
      restored_profiles: mergedProfileIds,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("[unmerge-clients] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
