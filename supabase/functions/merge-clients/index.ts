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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { caseId, masterId, mergedIds } = await req.json();

    if (!caseId || !masterId || !mergedIds?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Merging clients: master=${masterId}, merged=${mergedIds.join(",")}`);

    // Get master profile user_id
    const { data: masterProfile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("id", masterId)
      .single();

    if (!masterProfile) {
      throw new Error("Master profile not found");
    }

    const masterUserId = masterProfile.user_id;

    // Get merged profiles user_ids
    const { data: mergedProfiles } = await supabase
      .from("profiles")
      .select("id, user_id")
      .in("id", mergedIds);

    const mergedUserIds = mergedProfiles?.map(p => p.user_id) || [];

    // Transfer orders to master
    for (const userId of mergedUserIds) {
      await supabase
        .from("orders")
        .update({ user_id: masterUserId })
        .eq("user_id", userId);
    }

    // Transfer entitlements to master
    for (const userId of mergedUserIds) {
      await supabase
        .from("entitlements")
        .update({ user_id: masterUserId })
        .eq("user_id", userId);
    }

    // Transfer subscriptions (keep only the best one)
    for (const userId of mergedUserIds) {
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId);
      
      if (subs?.length) {
        // Archive old subscriptions by updating to master
        await supabase
          .from("subscriptions")
          .update({ user_id: masterUserId })
          .eq("user_id", userId);
      }
    }

    // Archive merged profiles
    for (const profileId of mergedIds) {
      await supabase
        .from("profiles")
        .update({
          is_archived: true,
          merged_to_profile_id: masterId,
          duplicate_flag: "none",
        })
        .eq("id", profileId);
    }

    // Update master profile
    await supabase
      .from("profiles")
      .update({
        duplicate_flag: "none",
        primary_in_group: true,
      })
      .eq("id", masterId);

    // Update case status
    await supabase
      .from("duplicate_cases")
      .update({
        status: "merged",
        master_profile_id: masterId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", caseId);

    // Update client_duplicates
    await supabase
      .from("client_duplicates")
      .update({ is_master: true })
      .eq("case_id", caseId)
      .eq("profile_id", masterId);

    // Log merge in history
    await supabase.from("merge_history").insert({
      case_id: caseId,
      master_profile_id: masterId,
      merged_data: { merged_profile_ids: mergedIds, merged_user_ids: mergedUserIds },
    });

    console.log("Merge completed successfully");

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Merge error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
