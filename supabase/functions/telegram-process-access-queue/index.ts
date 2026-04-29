import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { hasValidAccess } from "../_shared/accessValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface QueueItem {
  id: string;
  user_id: string;
  club_id: string;
  subscription_id: string | null;
  action: "grant" | "revoke";
  attempts: number;
  meta:
    | {
        parent_event_key?: string;
        parent_execution_key?: string;
        source?: string;
      }
    | null;
}

// Whitelist of explicit MANUAL/REPAIR sources that are allowed to drive
// telegram_access_queue. The legacy auto-grant path
// (subscriptions_v2 trigger → queue) is decommissioned: canonical write-path
// for any payment-driven Telegram DM is grant-access-for-order →
// telegram-grant-access. Anything that lands in the queue without one of
// these sources is treated as a stray legacy insert and skipped.
const ALLOWED_QUEUE_SOURCES = new Set([
  "reinvite",
  "manual_bulk",
  "repair",
  "admin_backfill",
]);

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
      .select("id, user_id, club_id, subscription_id, action, attempts, meta")
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

    const results: { id: string; success: boolean; error?: string; decision?: string }[] = [];

    for (const item of pendingItems as QueueItem[]) {
      console.log(`[telegram-process-access-queue] Processing item ${item.id}: ${item.action} for user ${item.user_id}`);

      // Mark as processing
      await supabase
        .from("telegram_access_queue")
        .update({ status: "processing", attempts: item.attempts + 1 })
        .eq("id", item.id);

      try {
        if (item.action === "grant") {
          // ============================================================
          // PATCH TG-REVOKE-FALSE-REGRANT: Guard 1 — hasValidAccess check
          // ============================================================
          const accessCheck = await hasValidAccess(supabase, item.user_id, item.club_id);
          
          if (!accessCheck.valid) {
            console.log(`[telegram-process-access-queue] SKIP item ${item.id}: no valid access for user ${item.user_id} in club ${item.club_id}`);
            
            await supabase
              .from("telegram_access_queue")
              .update({
                status: "skipped",
                last_error: "no_valid_access",
                processed_at: new Date().toISOString(),
              })
              .eq("id", item.id);

            // Audit log
            await supabase.from("audit_logs").insert({
              action: "telegram.queue_skipped",
              actor_type: "system",
              actor_label: "telegram-process-access-queue",
              meta: {
                queue_item_id: item.id,
                user_id: item.user_id,
                club_id: item.club_id,
                subscription_id: item.subscription_id,
                reason_code: "queue_skipped",
                trigger_type: "queue",
                decision: "skipped",
              },
            });

            results.push({ id: item.id, success: false, error: "no_valid_access", decision: "skipped" });
            continue;
          }

          // ============================================================
          // PATCH TG-REVOKE-FALSE-REGRANT: Guard 2 — recent revoke check (race protection)
          // ============================================================
          const { data: recentRevoke } = await supabase
            .from("telegram_access")
            .select("id, state_chat, updated_at")
            .eq("user_id", item.user_id)
            .eq("club_id", item.club_id)
            .eq("state_chat", "revoked")
            .gt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
            .maybeSingle();

          if (recentRevoke) {
            console.log(`[telegram-process-access-queue] SKIP item ${item.id}: recent revoke for user ${item.user_id} (revoke at ${recentRevoke.updated_at})`);
            
            await supabase
              .from("telegram_access_queue")
              .update({
                status: "skipped",
                last_error: "recent_revoke",
                processed_at: new Date().toISOString(),
              })
              .eq("id", item.id);

            await supabase.from("audit_logs").insert({
              action: "telegram.queue_skipped",
              actor_type: "system",
              actor_label: "telegram-process-access-queue",
              meta: {
                queue_item_id: item.id,
                user_id: item.user_id,
                club_id: item.club_id,
                reason_code: "queue_skipped",
                trigger_type: "queue",
                decision: "skipped",
                detail: "recent_revoke_race_guard",
                revoke_at: recentRevoke.updated_at,
              },
            });

            results.push({ id: item.id, success: false, error: "recent_revoke", decision: "skipped" });
            continue;
          }

          // Fetch subscription details for tariff/product logging + club linkage check
          let tariffName: string | null = null;
          let productName: string | null = null;
          let subscriptionProductId: string | null = null;
          
          if (item.subscription_id) {
            const { data: sub } = await supabase
              .from("subscriptions_v2")
              .select(`
                tariff_id,
                product_id,
                tariffs(name, code),
                products_v2(name)
              `)
              .eq("id", item.subscription_id)
              .maybeSingle();
            
            if (sub) {
              // @ts-ignore - nested join types
              tariffName = sub.tariffs?.name || sub.tariffs?.code || "UNKNOWN";
              // @ts-ignore - nested join types
              productName = sub.products_v2?.name || "UNKNOWN";
              subscriptionProductId = sub.product_id;
              console.log(`[telegram-process-access-queue] Subscription ${item.subscription_id}: tariff=${tariffName}, product=${productName}`);
            }
          }
          
          // Fallback: resolve product via access_rules if no subscription_id
          let productResolveSource: string | null = null;
          if (!productName && item.club_id) {
            const { data: clubRules } = await supabase
              .from("access_rules")
              .select("product_id, products_v2:product_id(name)")
              .eq("target_ref", item.club_id)
              .eq("grant_target_type", "club")
              .eq("is_active", true);

            if (clubRules && clubRules.length === 1) {
              // @ts-ignore - nested join types
              productName = clubRules[0].products_v2?.name || null;
              subscriptionProductId = subscriptionProductId || clubRules[0].product_id;
              productResolveSource = "access_rules";
              console.log(`[telegram-process-access-queue] Fallback: resolved product via access_rules for club ${item.club_id}: product=${productName}, product_id=${subscriptionProductId}`);
            } else if (clubRules && clubRules.length > 1) {
              // Ambiguous: multiple active rules for this club
              productResolveSource = "access_rules_ambiguous";
              console.warn(`[telegram-process-access-queue] WARNING: ${clubRules.length} active rules for club ${item.club_id} — leaving product_name as UNKNOWN`);
            }
          }

          tariffName = tariffName || "UNKNOWN";
          productName = productName || "UNKNOWN";

          // ============================================================
          // PATCH TG-CLUB-LINKAGE-INTEGRITY: Guard 3 — club-product access_rules check
          // ============================================================
          if (subscriptionProductId) {
            const { data: ruleCheck } = await supabase
              .from("access_rules")
              .select("id")
              .eq("product_id", subscriptionProductId)
              .eq("target_ref", item.club_id)
              .eq("grant_target_type", "club")
              .eq("is_active", true)
              .maybeSingle();

            if (!ruleCheck) {
              console.log(`[telegram-process-access-queue] SKIP item ${item.id}: club_product_mismatch — product ${subscriptionProductId} not mapped to club ${item.club_id}`);
              
              await supabase
                .from("telegram_access_queue")
                .update({
                  status: "skipped",
                  last_error: "club_product_mismatch",
                  processed_at: new Date().toISOString(),
                })
                .eq("id", item.id);

              await supabase.from("audit_logs").insert({
                action: "telegram.queue_skipped",
                actor_type: "system",
                actor_label: "telegram-process-access-queue",
                meta: {
                  queue_item_id: item.id,
                  user_id: item.user_id,
                  club_id: item.club_id,
                  subscription_id: item.subscription_id,
                  product_id: subscriptionProductId,
                  reason_code: "club_product_mismatch",
                  trigger_type: "queue",
                  decision: "skipped",
                },
              });

              results.push({ id: item.id, success: false, error: "club_product_mismatch", decision: "skipped" });
              continue;
            }
          }
          
          // Sub-patch B: Extract parent lineage from queue meta
          const queueParentEventKey = (item.meta as any)?.parent_event_key || null;
          const queueParentExecutionKey = (item.meta as any)?.parent_execution_key || null;

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
                tariff_name: tariffName,
                product_name: productName,
                product_id: subscriptionProductId,
                product_resolve_source: productResolveSource,
                // Sub-patch B: Forward parent lineage (nullable, queue is not primary)
                parent_event_key: queueParentEventKey,
                parent_execution_key: queueParentExecutionKey,
              },
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
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
          results.push({ id: item.id, success: true, decision: "granted" });

        } else if (item.action === "revoke") {
          // Sub-patch B: Extract parent lineage from queue meta for revoke
          const revokeParentEventKey = (item.meta as any)?.parent_event_key || null;
          const revokeParentExecutionKey = (item.meta as any)?.parent_execution_key || null;

          // Call telegram-revoke-access
          const { data: revokeResult, error: revokeError } = await supabase.functions.invoke(
            "telegram-revoke-access",
            {
              body: {
                user_id: item.user_id,
                club_id: item.club_id,
                // Sub-patch B: Forward parent lineage (nullable)
                parent_event_key: revokeParentEventKey,
                parent_execution_key: revokeParentExecutionKey,
              },
              headers: {
                Authorization: `Bearer ${supabaseKey}`,
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
          results.push({ id: item.id, success: true, decision: "revoked" });
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

        results.push({ id: item.id, success: false, error: errorMessage, decision: "error" });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const skippedCount = results.filter((r) => r.decision === "skipped").length;

    console.log(`[telegram-process-access-queue] Completed: ${successCount} success, ${failCount} failed, ${skippedCount} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successCount,
        failCount,
        skippedCount,
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
