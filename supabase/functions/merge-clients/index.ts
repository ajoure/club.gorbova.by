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

    // Verify auth using getClaims
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

    // Use service role for actual operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { caseId, masterId, mergedIds: rawMergedIds } = await req.json();

    if (!caseId || !masterId || !rawMergedIds?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // IMPORTANT: Ensure masterId is NOT in mergedIds
    const mergedIds = rawMergedIds.filter((id: string) => id !== masterId);
    if (mergedIds.length === 0) {
      return new Response(JSON.stringify({ error: "No profiles to merge after excluding master" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Merging clients: master=${masterId}, merged=${mergedIds.join(",")}`);

    // Get master profile
    const { data: masterProfile } = await supabase
      .from("profiles")
      .select("id, user_id")
      .eq("id", masterId)
      .single();

    if (!masterProfile) {
      throw new Error("Master profile not found");
    }

    const masterProfileId = masterProfile.id;
    const masterUserId = masterProfile.user_id;

    // Get merged profiles
    const { data: mergedProfiles } = await supabase
      .from("profiles")
      .select("id, user_id")
      .in("id", mergedIds);

    const mergedProfileIds = mergedProfiles?.map(p => p.id) || [];
    const mergedUserIds = mergedProfiles?.map(p => p.user_id).filter(Boolean) || [];

    // Collect all IDs that we need to re-assign (profile ids + user_ids)
    const allMergedIds = [...new Set([...mergedProfileIds, ...mergedUserIds])];

    console.log(`Master: profileId=${masterProfileId}, userId=${masterUserId}`);
    console.log(`Merged IDs (profile+user): ${allMergedIds.join(",")}`);

    let transferredOrders = 0;
    let transferredSubscriptions = 0;
    let transferredEntitlements = 0;

    // Transfer orders_v2 to master (user_id can be profile.id or auth.user_id)
    if (allMergedIds.length > 0) {
      const { data: ordersData } = await supabase
        .from("orders_v2")
        .update({ user_id: masterUserId || masterProfileId })
        .in("user_id", allMergedIds)
        .select("id");
      transferredOrders = ordersData?.length || 0;
      console.log(`Transferred ${transferredOrders} orders to master`);
    }

    // Transfer subscriptions_v2 to master
    if (allMergedIds.length > 0) {
      const { data: subsData } = await supabase
        .from("subscriptions_v2")
        .update({ user_id: masterUserId || masterProfileId })
        .in("user_id", allMergedIds)
        .select("id");
      transferredSubscriptions = subsData?.length || 0;
      console.log(`Transferred ${transferredSubscriptions} subscriptions to master`);
    }

    // Transfer entitlements to master
    if (allMergedIds.length > 0) {
      const { data: entData } = await supabase
        .from("entitlements")
        .update({ user_id: masterUserId || masterProfileId })
        .in("user_id", allMergedIds)
        .select("id");
      transferredEntitlements = entData?.length || 0;
      console.log(`Transferred ${transferredEntitlements} entitlements to master`);
    }

    // Update payment_reconcile_queue to point to master profile
    if (mergedProfileIds.length > 0) {
      await supabase
        .from("payment_reconcile_queue")
        .update({ matched_profile_id: masterProfileId })
        .in("matched_profile_id", mergedProfileIds);
    }

    // Transfer consent_logs
    if (mergedUserIds.length > 0) {
      await supabase
        .from("consent_logs")
        .update({ user_id: masterUserId })
        .in("user_id", mergedUserIds);
    }

    // Archive merged profiles (NOT the master!)
    for (const profileId of mergedProfileIds) {
      await supabase
        .from("profiles")
        .update({
          is_archived: true,
          merged_to_profile_id: masterProfileId,
          duplicate_flag: "none",
        })
        .eq("id", profileId);
    }

    // IMPORTANT: Ensure master is ACTIVE (not archived)
    await supabase
      .from("profiles")
      .update({
        is_archived: false,
        merged_to_profile_id: null,
        duplicate_flag: "none",
        primary_in_group: true,
      })
      .eq("id", masterProfileId);

    // Update case status
    await supabase
      .from("duplicate_cases")
      .update({
        status: "merged",
        master_profile_id: masterProfileId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", caseId);

    // Update client_duplicates
    await supabase
      .from("client_duplicates")
      .update({ is_master: true })
      .eq("case_id", caseId)
      .eq("profile_id", masterProfileId);

    await supabase
      .from("client_duplicates")
      .update({ is_master: false })
      .eq("case_id", caseId)
      .in("profile_id", mergedProfileIds);

    // Log merge in history
    await supabase.from("merge_history").insert({
      case_id: caseId,
      master_profile_id: masterProfileId,
      merged_data: { 
        merged_profile_ids: mergedProfileIds, 
        merged_user_ids: mergedUserIds,
        transferred: {
          orders: transferredOrders,
          subscriptions: transferredSubscriptions,
          entitlements: transferredEntitlements,
        }
      },
    });

    console.log("Merge completed successfully");

    return new Response(JSON.stringify({ 
      success: true,
      transferred: {
        orders: transferredOrders,
        subscriptions: transferredSubscriptions,
        entitlements: transferredEntitlements,
      }
    }), {
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
