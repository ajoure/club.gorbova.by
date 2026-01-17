import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    const { limit = 100, offset = 0 } = await req.json().catch(() => ({}));

    console.log(`[analyze-all-loyalty] Starting batch analysis, limit=${limit}, offset=${offset}`);

    // Get all unique telegram_user_ids from messages
    const { data: uniqueUsers, error: usersError } = await supabase
      .from("tg_chat_messages")
      .select("telegram_user_id")
      .not("telegram_user_id", "is", null)
      .order("telegram_user_id");

    if (usersError) {
      console.error("[analyze-all-loyalty] Error fetching unique users:", usersError);
      throw usersError;
    }

    // Get unique user IDs
    const userIds = [...new Set(uniqueUsers?.map(u => u.telegram_user_id) || [])];
    console.log(`[analyze-all-loyalty] Found ${userIds.length} unique users with messages`);

    // Get profiles that have these telegram_user_ids
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, telegram_user_id, first_name, last_name")
      .in("telegram_user_id", userIds)
      .range(offset, offset + limit - 1);

    if (profilesError) {
      console.error("[analyze-all-loyalty] Error fetching profiles:", profilesError);
      throw profilesError;
    }

    console.log(`[analyze-all-loyalty] Processing ${profiles?.length || 0} profiles`);

    const results = {
      total: profiles?.length || 0,
      processed: 0,
      success: 0,
      errors: 0,
      noMessages: 0,
      details: [] as Array<{ profile_id: string; status: string; score?: number; error?: string }>,
    };

    // Process each profile
    for (const profile of profiles || []) {
      try {
        console.log(`[analyze-all-loyalty] Processing profile ${profile.id} (${profile.first_name} ${profile.last_name})`);

        // Call the single contact analysis function
        const { data, error } = await supabase.functions.invoke("analyze-contact-loyalty", {
          body: { 
            profile_id: profile.id,
            telegram_user_id: profile.telegram_user_id,
          },
        });

        if (error) {
          console.error(`[analyze-all-loyalty] Error analyzing ${profile.id}:`, error);
          results.errors++;
          results.details.push({ 
            profile_id: profile.id, 
            status: "error", 
            error: error.message 
          });
        } else if (data?.score === null) {
          results.noMessages++;
          results.details.push({ 
            profile_id: profile.id, 
            status: "no_messages" 
          });
        } else {
          results.success++;
          results.details.push({ 
            profile_id: profile.id, 
            status: "success", 
            score: data?.score 
          });
        }

        results.processed++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`[analyze-all-loyalty] Exception for ${profile.id}:`, error);
        results.errors++;
        results.details.push({ 
          profile_id: profile.id, 
          status: "exception", 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
        results.processed++;
      }
    }

    // Also update profiles without messages to have null score
    const { data: profilesWithNoMessages } = await supabase
      .from("profiles")
      .select("id")
      .not("telegram_user_id", "in", `(${userIds.join(",")})`)
      .not("telegram_user_id", "is", null);

    if (profilesWithNoMessages && profilesWithNoMessages.length > 0) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          loyalty_score: null,
          loyalty_ai_summary: "Нет сообщений для анализа",
          loyalty_status_reason: "Клиент не оставлял сообщений в чатах",
          loyalty_proofs: [],
          loyalty_analyzed_messages_count: 0,
        })
        .in("id", profilesWithNoMessages.map(p => p.id));

      if (!updateError) {
        results.noMessages += profilesWithNoMessages.length;
      }
    }

    console.log(`[analyze-all-loyalty] Batch complete: ${results.success} success, ${results.errors} errors, ${results.noMessages} no messages`);

    return new Response(
      JSON.stringify({
        ...results,
        success: true,
        has_more: (offset + limit) < userIds.length,
        next_offset: offset + limit,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-all-loyalty] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
