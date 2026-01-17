import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { channel_id } = body;

    console.log("[sync-history] Starting sync of ALL chat messages");

    // Fetch ALL messages from the chat (not just Katerina)
    const { data: messages, error: fetchError } = await supabase
      .from("tg_chat_messages")
      .select("id, text, message_ts, from_display_name, from_tg_user_id, chat_id")
      .not("text", "is", null)
      .order("message_ts", { ascending: false });

    if (fetchError) {
      console.error("[sync-history] Fetch error:", fetchError);
      throw new Error(`Failed to fetch messages: ${fetchError.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "Нет сообщений для синхронизации",
        total_messages: 0,
        synced: 0,
        by_user: {},
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[sync-history] Found ${messages.length} total messages`);

    // Group messages by user
    const byUser: Record<string, { count: number; name: string; user_id: number }> = {};
    for (const msg of messages) {
      const key = String(msg.from_tg_user_id || 'unknown');
      if (!byUser[key]) {
        byUser[key] = { 
          count: 0, 
          name: msg.from_display_name || 'Unknown',
          user_id: msg.from_tg_user_id || 0
        };
      }
      byUser[key].count++;
    }

    // Separate messages: Katerina (99340019) for style, others for audience
    const KATERINA_USER_ID = 99340019;
    const katerinaMessages = messages.filter(m => m.from_tg_user_id === KATERINA_USER_ID);
    const audienceMessages = messages.filter(m => m.from_tg_user_id !== KATERINA_USER_ID);

    // Filter meaningful messages (at least 20 chars)
    const meaningfulKaterina = katerinaMessages.filter(
      (m) => m.text && m.text.trim().length >= 20
    );
    const meaningfulAudience = audienceMessages.filter(
      (m) => m.text && m.text.trim().length >= 10 // Lower threshold for audience
    );

    console.log(`[sync-history] Katerina: ${meaningfulKaterina.length} meaningful`);
    console.log(`[sync-history] Audience: ${meaningfulAudience.length} meaningful`);

    // Get date range
    const allMeaningful = [...meaningfulKaterina, ...meaningfulAudience];
    const sortedByDate = [...allMeaningful].sort(
      (a, b) => new Date(a.message_ts).getTime() - new Date(b.message_ts).getTime()
    );
    
    const earliestDate = sortedByDate.length > 0 ? sortedByDate[0].message_ts : null;
    const latestDate = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].message_ts : null;

    // Sync Katerina's messages to channel_posts_archive for style learning
    let syncedKaterina = 0;
    if (channel_id && meaningfulKaterina.length > 0) {
      const records = meaningfulKaterina.map((msg, idx) => ({
        channel_id: channel_id,
        telegram_message_id: parseInt(msg.id) || idx,
        text: msg.text,
        date: msg.message_ts,
        from_name: msg.from_display_name || "@katerinagorbova",
        imported_at: new Date().toISOString(),
      }));

      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from("channel_posts_archive")
          .upsert(batch, { 
            onConflict: "channel_id,telegram_message_id",
            ignoreDuplicates: true 
          });

        if (!upsertError) {
          syncedKaterina += batch.length;
        }
      }
      console.log(`[sync-history] Synced ${syncedKaterina} Katerina messages to archive`);
    }

    // Count unique users in audience
    const uniqueUsers = new Set(audienceMessages.map(m => m.from_tg_user_id)).size;

    // Log the action
    await supabase.from("telegram_logs").insert({
      action: "SYNC_ALL_CHAT_HISTORY",
      target: channel_id || "all_messages",
      status: "ok",
      meta: {
        total_messages: messages.length,
        katerina_messages: katerinaMessages.length,
        katerina_meaningful: meaningfulKaterina.length,
        audience_messages: audienceMessages.length,
        audience_meaningful: meaningfulAudience.length,
        unique_users: uniqueUsers,
        synced_katerina: syncedKaterina,
        earliest_date: earliestDate,
        latest_date: latestDate,
        by_user: byUser,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      message: "История чата синхронизирована",
      total_messages: messages.length,
      katerina_messages: katerinaMessages.length,
      katerina_meaningful: meaningfulKaterina.length,
      audience_messages: audienceMessages.length,
      audience_meaningful: meaningfulAudience.length,
      unique_users: uniqueUsers,
      synced_katerina: syncedKaterina,
      earliest_date: earliestDate,
      latest_date: latestDate,
      ready_for_style: meaningfulKaterina.length >= 5,
      ready_for_audience_analysis: meaningfulAudience.length >= 10,
      by_user: byUser,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[sync-history] Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
