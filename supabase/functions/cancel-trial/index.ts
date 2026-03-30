import { createClient } from "npm:@supabase/supabase-js@2";
import { executeRevoke, type RevokeContext } from '../_shared/access-revoker.ts';
import { writeLedgerEntry, type LedgerEntry } from '../_shared/fulfillment-executor.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper to generate deal_number from order_number
function generateDealNumber(orderNumber: string): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    const char = orderNumber.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) % 1000000000;
}

// Cancel order in GetCourse
async function cancelInGetCourse(
  email: string,
  offerId: number | string,
  orderNumber: string,
  reason: string,
  amount: number = 0,
  gcDealNumber?: number
): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('[cancel-trial] GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log('[cancel-trial] No offerId for GetCourse cancel, skipping');
    return { success: false, error: 'No offer ID' };
  }
  
  try {
    console.log(`[cancel-trial] Canceling in GetCourse: email=${email}, offerId=${offerId}, gcDealNumber=${gcDealNumber}`);
    
    const dealParams: Record<string, any> = {
      offer_code: offerId.toString(),
      deal_cost: amount,
      deal_is_paid: 0, // Устанавливаем ложный статус оплаты вместо отмены
      deal_comment: `Trial отменён пользователем. ${reason}. Order: ${orderNumber}`,
    };
    
    // Use deal_number to update existing deal
    if (gcDealNumber) {
      dealParams.deal_number = gcDealNumber;
      console.log(`[cancel-trial] Using deal_number=${gcDealNumber} to update existing deal`);
    }
    
    const params = {
      user: { email },
      system: { refresh_if_exists: 1 },
      deal: dealParams,
    };
    
    console.log('[cancel-trial] GetCourse cancel params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('[cancel-trial] GetCourse response:', responseText);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      return { success: false, error: `Invalid response: ${responseText}` };
    }
    
    if (result.result?.success === true || result.success === true) {
      console.log('[cancel-trial] GetCourse cancel successful');
      return { success: true };
    }
    
    return { success: false, error: result.error_message || 'Unknown error' };
  } catch (error) {
    console.error('[cancel-trial] GetCourse cancel error:', error);
    return { success: false, error: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { subscriptionId, reason } = await req.json();

    if (!subscriptionId) {
      return new Response(
        JSON.stringify({ error: "subscriptionId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[cancel-trial] Processing cancel for subscription: ${subscriptionId}`);

    // Get subscription with order and tariff data
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions_v2")
      .select(`
        *,
        products_v2(id, name, telegram_club_id),
        orders_v2(id, order_number, final_price, customer_email, meta),
        tariffs(id, name, getcourse_offer_id)
      `)
      .eq("id", subscriptionId)
      .single();

    if (subError || !subscription) {
      console.error("[cancel-trial] Subscription not found:", subError);
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if it's a trial subscription
    if (!subscription.is_trial || subscription.status !== "trial") {
      return new Response(
        JSON.stringify({ error: "This subscription is not in trial status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already canceled
    if (subscription.trial_canceled_at) {
      return new Response(
        JSON.stringify({ error: "Trial already canceled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cancel the trial - prevent future auto-charge
    const { error: updateError } = await supabase
      .from("subscriptions_v2")
      .update({
        trial_canceled_at: new Date().toISOString(),
        trial_canceled_by: reason || "user_request",
        // Keep access until trial end if configured
        status: subscription.keep_access_until_trial_end ? "trial" : "canceled",
        canceled_at: subscription.keep_access_until_trial_end ? null : new Date().toISOString(),
        cancel_reason: reason || "Trial canceled by user",
      })
      .eq("id", subscriptionId);

    if (updateError) {
      console.error("[cancel-trial] Error updating subscription:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to cancel trial" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== GetCourse Sync ====================
    let gcResult: { success: boolean; error?: string } = { success: false, error: 'No data for sync' };
    
    const order = subscription.orders_v2 as any;
    const tariff = subscription.tariffs as any;
    const orderMeta = (order?.meta || {}) as Record<string, any>;
    
    // Get offer_id from order meta ONLY (no backend lookup)
    let gcOfferId: string | number | null = null;
    if (orderMeta.offer_id) {
      // Lookup the offer's getcourse_offer_id
      const { data: offerData } = await supabase
        .from('tariff_offers')
        .select('getcourse_offer_id')
        .eq('id', orderMeta.offer_id)
        .maybeSingle();
      
      if (offerData?.getcourse_offer_id) {
        gcOfferId = offerData.getcourse_offer_id;
      }
    }
    
    // Fallback to tariff's getcourse_offer_id
    if (!gcOfferId && tariff?.getcourse_offer_id) {
      gcOfferId = tariff.getcourse_offer_id;
    }
    
    // Get email from order or profile
    let email = order?.customer_email;
    if (!email) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('user_id', subscription.user_id)
        .maybeSingle();
      email = profile?.email;
    }
    
    if (email && gcOfferId && order?.order_number) {
      // Use gc_deal_number from meta or generate from order_number
      const gcDealNumber = orderMeta.gc_deal_number || generateDealNumber(order.order_number);
      
      gcResult = await cancelInGetCourse(
        email,
        gcOfferId,
        order.order_number,
        reason || 'user_request',
        order.final_price || 0,
        gcDealNumber
      );
      
      console.log('[cancel-trial] GetCourse cancel result:', gcResult);
    } else {
      console.log(`[cancel-trial] Missing data for GC sync: email=${email}, gcOfferId=${gcOfferId}, orderNumber=${order?.order_number}`);
    }

    // Log the cancellation BEFORE ledger write (need auditLogId for discriminator)
    const { data: auditLogRow } = await supabase.from("audit_logs").insert({
      action: "trial_canceled",
      actor_user_id: subscription.user_id,
      target_user_id: subscription.user_id,
      meta: {
        subscription_id: subscriptionId,
        product_id: subscription.product_id,
        reason: reason || "user_request",
        trial_end_at: subscription.trial_end_at,
        keep_access_until_trial_end: subscription.keep_access_until_trial_end,
        getcourse_cancel: gcResult,
      },
    }).select('id').single();

    const auditLogId = auditLogRow?.id || subscriptionId;

    // ==================== Phase 1 Ledger Write ====================
    // Machine-rule: keep_access_until_trial_end determines revoke vs skip
    try {
      if (subscription.keep_access_until_trial_end) {
        // Deferred cancel: projection unchanged by design. Future revoke expected from cron path.
        const skipEntry: LedgerEntry = {
          source_event_type: 'system',
          source_event_key: `trial-cancel-defer:${subscriptionId}:${auditLogId}`,
          source_subject_type: 'subscription',
          source_subject_ref: subscriptionId,
          source_subscription_id: subscriptionId,
          action_type: 'skip',
          reason_code: 'trial_expired',
          target_type: 'subscription_tier',
          target_key: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
          target_ref: subscription.product_id || null,
          user_id: subscription.user_id,
          profile_id: null,
          order_id: subscription.order_id || null,
          status: 'skipped',
          result: {
            skip_reason: 'trial_cancel_deferred',
            projection_unchanged: true,
            future_revoke_expected: 'cron_path',
            trial_end_at: subscription.trial_end_at,
            keep_access_until_trial_end: true,
            reconcile_basis: 'trial_cancel_deferred',
          },
          parent_event_key: null,
          parent_execution_key: null,
        };
        const ledgerResult = await writeLedgerEntry(supabase, skipEntry);
        console.log(`[cancel-trial] Ledger skip (deferred): id=${ledgerResult.id}, key=${ledgerResult.execution_key}`);
      } else {
        // Immediate cancel: projection changes now → executeRevoke
        const revokeCtx: RevokeContext = {
          userId: subscription.user_id,
          profileId: null,
          orderId: subscription.order_id || null,
          targetType: 'subscription_tier',
          targetKey: `${subscription.user_id}:${subscription.tariff_id || subscription.product_id || 'unknown'}`,
          targetRef: subscription.product_id || null,
          subscriptionId: subscriptionId,
          reasonCode: 'trial_expired',
          reconcileBasis: 'trial_cancel_immediate',
          sourceEventType: 'system',
          sourceEventKey: `trial-cancel:${subscriptionId}:${auditLogId}`,
          sourceSubjectType: 'subscription',
          sourceSubjectRef: subscriptionId,
          parentEventKey: null,
          parentExecutionKey: null,
          clubId: (subscription.products_v2 as any)?.telegram_club_id || null,
        };
        const revokeResult = await executeRevoke(supabase, revokeCtx);
        console.log(`[cancel-trial] Ledger revoke: revoked=${revokeResult.revoked}, id=${revokeResult.ledgerId}`);
      }
    } catch (ledgerErr) {
      // Non-blocking: ledger write failure should not break the cancel flow
      console.error('[cancel-trial] Ledger write error (non-blocking):', ledgerErr);
    }

    console.log(`[cancel-trial] Successfully canceled trial for subscription: ${subscriptionId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: subscription.keep_access_until_trial_end
          ? `Trial отменен. Доступ сохранится до ${new Date(subscription.trial_end_at).toLocaleDateString("ru-RU")}`
          : "Trial отменен и доступ прекращен",
        access_until: subscription.keep_access_until_trial_end ? subscription.trial_end_at : null,
        getcourse_cancel: gcResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[cancel-trial] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
