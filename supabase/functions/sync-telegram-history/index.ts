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
    const { channel_id, katerina_user_id = 99340019 } = body;

    console.log("[sync-history] Starting sync for channel:", channel_id);

    // Fetch all messages from Katerina Gorbova
    const { data: messages, error: fetchError } = await supabase
      .from("tg_chat_messages")
      .select("id, text, message_ts, from_username, chat_id")
      .eq("from_tg_user_id", katerina_user_id)
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
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[sync-history] Found ${messages.length} messages from Katerina`);

    // Filter meaningful messages (at least 20 chars)
    const meaningfulMessages = messages.filter(
      (m) => m.text && m.text.trim().length >= 20
    );

    console.log(`[sync-history] ${meaningfulMessages.length} meaningful messages`);

    // Get date range
    const sortedByDate = [...meaningfulMessages].sort(
      (a, b) => new Date(a.message_ts).getTime() - new Date(b.message_ts).getTime()
    );
    
    const earliestDate = sortedByDate.length > 0 ? sortedByDate[0].message_ts : null;
    const latestDate = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].message_ts : null;

    // Prepare records for channel_posts_archive (if channel_id provided)
    let syncedCount = 0;
    if (channel_id && meaningfulMessages.length > 0) {
      const records = meaningfulMessages.map((msg, idx) => ({
        channel_id: channel_id,
        telegram_message_id: parseInt(msg.id) || idx,
        text: msg.text,
        date: msg.message_ts,
        from_name: msg.from_username || "@katerinagorbova",
        imported_at: new Date().toISOString(),
      }));

      // Upsert in batches
      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from("channel_posts_archive")
          .upsert(batch, { 
            onConflict: "channel_id,telegram_message_id",
            ignoreDuplicates: true 
          });

        if (upsertError) {
          console.error("[sync-history] Upsert error:", upsertError);
          // Continue with other batches
        } else {
          syncedCount += batch.length;
        }
      }

      console.log(`[sync-history] Synced ${syncedCount} messages to archive`);
    }

    // Log the action
    await supabase.from("telegram_logs").insert({
      action: "SYNC_CHAT_HISTORY",
      target: channel_id || "katerina_messages",
      status: "ok",
      meta: {
        total_messages: messages.length,
        meaningful_messages: meaningfulMessages.length,
        synced_to_archive: syncedCount,
        earliest_date: earliestDate,
        latest_date: latestDate,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      message: "История синхронизирована",
      total_messages: messages.length,
      meaningful_messages: meaningfulMessages.length,
      synced: syncedCount,
      earliest_date: earliestDate,
      latest_date: latestDate,
      ready_for_analysis: meaningfulMessages.length >= 5,
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
