import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueItem {
  id: string;
  user_id: string;
  club_id: string;
  subscription_id: string | null;
  action: "grant" | "revoke";
  attempts: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("[telegram-process-access-queue] Starting queue processing");

  try {
    // Get pending items (limit to 10 to avoid timeouts)
    const { data: pendingItems, error: fetchError } = await supabase
      .from("telegram_access_queue")
      .select("id, user_id, club_id, subscription_id, action, attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error("[telegram-process-access-queue] Error fetching queue:", fetchError);
      throw fetchError;
    }

    if (!pendingItems || pendingItems.length === 0) {
      console.log("[telegram-process-access-queue] No pending items");
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[telegram-process-access-queue] Processing ${pendingItems.length} items`);

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const item of pendingItems as QueueItem[]) {
      console.log(`[telegram-process-access-queue] Processing item ${item.id}: ${item.action} for user ${item.user_id}`);

      // Mark as processing
      await supabase
        .from("telegram_access_queue")
        .update({ status: "processing", attempts: item.attempts + 1 })
        .eq("id", item.id);

      try {
        if (item.action === "grant") {
          // Call telegram-grant-access
          const { data: grantResult, error: grantError } = await supabase.functions.invoke(
            "telegram-grant-access",
            {
              body: {
                user_id: item.user_id,
                club_id: item.club_id,
                is_manual: false,
                source: "auto_subscription",
                source_id: item.subscription_id,
              },
            }
          );

          if (grantError) {
            throw new Error(grantError.message || "Grant access failed");
          }

          if (!grantResult?.success && !grantResult?.results) {
            throw new Error(grantResult?.error || "Grant access returned no success");
          }

          // Mark as completed
          await supabase
            .from("telegram_access_queue")
            .update({
              status: "completed",
              processed_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          console.log(`[telegram-process-access-queue] Item ${item.id} completed successfully`);
          results.push({ id: item.id, success: true });

        } else if (item.action === "revoke") {
          // Call telegram-revoke-access
          const { data: revokeResult, error: revokeError } = await supabase.functions.invoke(
            "telegram-revoke-access",
            {
              body: {
                user_id: item.user_id,
                club_id: item.club_id,
              },
            }
          );

          if (revokeError) {
            throw new Error(revokeError.message || "Revoke access failed");
          }

          // Mark as completed
          await supabase
            .from("telegram_access_queue")
            .update({
              status: "completed",
              processed_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          console.log(`[telegram-process-access-queue] Item ${item.id} revoked successfully`);
          results.push({ id: item.id, success: true });
        }

      } catch (itemError) {
        const errorMessage = (itemError as Error).message || "Unknown error";
        console.error(`[telegram-process-access-queue] Error processing item ${item.id}:`, errorMessage);

        // Mark as failed if too many attempts, otherwise back to pending
        const newStatus = item.attempts >= 3 ? "failed" : "pending";
        await supabase
          .from("telegram_access_queue")
          .update({
            status: newStatus,
            last_error: errorMessage,
            processed_at: newStatus === "failed" ? new Date().toISOString() : null,
          })
          .eq("id", item.id);

        results.push({ id: item.id, success: false, error: errorMessage });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`[telegram-process-access-queue] Completed: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successCount,
        failCount,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("[telegram-process-access-queue] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
