import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FixRequest {
  payment_uids: string[];
  dry_run?: boolean;
  limit?: number;
}

interface CaseResult {
  uid: string;
  payment_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  action_taken: 'status_fixed' | 'type_fixed' | 'access_revoked' | 'access_kept' | 'skipped' | 'not_found';
  has_other_valid_access: boolean;
  details: {
    payment_status_before: string | null;
    payment_status_after: string | null;
    payment_type_before: string | null;
    payment_type_after: string | null;
    order_ids: string[];
    subscription_ids: string[];
    entitlement_ids: string[];
    orders_cancelled: number;
    subscriptions_disabled: number;
    entitlements_revoked: number;
  };
  reason: string;
}

interface FixResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    total_requested: number;
    found: number;
    fixed: number;
    skipped: number;
    errors: number;
  };
  cases: CaseResult[];
  audit_actions: string[];
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    // Dual client pattern: user client for auth, admin client for data
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check user permissions
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role
    const { data: hasRole } = await supabaseAdmin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    
    if (!hasRole) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: FixRequest = await req.json();
    const { payment_uids, dry_run = true, limit = 50 } = body;

    if (!payment_uids || !Array.isArray(payment_uids) || payment_uids.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No payment_uids provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uidsToProcess = payment_uids.slice(0, limit);
    console.log(`[admin-fix-false-payments] Processing ${uidsToProcess.length} UIDs, dry_run=${dry_run}`);

    const cases: CaseResult[] = [];
    const auditActions: string[] = [];
    const errors: string[] = [];
    let fixed = 0;
    let skipped = 0;

    for (const uid of uidsToProcess) {
      try {
        // Find payment by UID
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payments_v2")
          .select("id, provider_payment_id, status, transaction_type, amount, profile_id, order_id, user_id")
          .eq("provider_payment_id", uid)
          .single();

        if (paymentError || !payment) {
          cases.push({
            uid,
            payment_id: null,
            contact_email: null,
            contact_name: null,
            action_taken: 'not_found',
            has_other_valid_access: false,
            details: {
              payment_status_before: null,
              payment_status_after: null,
              payment_type_before: null,
              payment_type_after: null,
              order_ids: [],
              subscription_ids: [],
              entitlement_ids: [],
              orders_cancelled: 0,
              subscriptions_disabled: 0,
              entitlements_revoked: 0,
            },
            reason: `Payment not found for UID: ${uid}`,
          });
          skipped++;
          continue;
        }

        // Get profile info if linked
        let contactEmail: string | null = null;
        let contactName: string | null = null;
        if (payment.profile_id) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("email, full_name")
            .eq("id", payment.profile_id)
            .single();
          if (profile) {
            contactEmail = profile.email;
            contactName = profile.full_name;
          }
        }

        // Find related orders
        const { data: orders } = await supabaseAdmin
          .from("orders_v2")
          .select("id, status, profile_id")
          .or(`id.eq.${payment.order_id || 'null'},profile_id.eq.${payment.profile_id || 'null'}`);
        
        const orderIds = (orders || []).map(o => o.id);

        // Find subscriptions for user
        const { data: subscriptions } = await supabaseAdmin
          .from("subscriptions_v2")
          .select("id, status, auto_renew")
          .eq("user_id", payment.user_id || 'none')
          .in("status", ["active", "trial"]);
        
        const subscriptionIds = (subscriptions || []).map(s => s.id);

        // Find entitlements for user
        const { data: entitlements } = await supabaseAdmin
          .from("entitlements")
          .select("id, status, order_id")
          .eq("user_id", payment.user_id || 'none')
          .eq("status", "active");
        
        const entitlementIds = (entitlements || []).map(e => e.id);

        // Check if user has OTHER valid paid orders (not linked to this payment)
        const { data: otherOrders } = await supabaseAdmin
          .from("orders_v2")
          .select("id")
          .eq("profile_id", payment.profile_id || 'none')
          .eq("status", "paid")
          .neq("id", payment.order_id || 'none');
        
        const hasOtherValidAccess = (otherOrders?.length || 0) > 0;

        // Determine action based on payment type
        const isNegativeAmount = payment.amount < 0;
        const isPaymentType = (payment.transaction_type || '').toLowerCase().includes('payment');
        const needsTypeChange = isNegativeAmount && isPaymentType;
        
        let actionTaken: CaseResult['action_taken'] = 'skipped';
        let ordersСancelled = 0;
        let subscriptionsDisabled = 0;
        let entitlementsRevoked = 0;

        if (needsTypeChange) {
          // Case: negative amount with payment type -> should be refund
          actionTaken = 'type_fixed';
          
          if (!dry_run) {
            await supabaseAdmin
              .from("payments_v2")
              .update({
                transaction_type: 'refund',
                meta: {
                  type_corrected_at: new Date().toISOString(),
                  previous_type: payment.transaction_type,
                  correction_reason: 'Negative amount indicates refund, not payment',
                },
              })
              .eq("id", payment.id);
          }
          fixed++;
        } else if (hasOtherValidAccess) {
          // User has other valid access - only fix payment, keep access
          actionTaken = 'access_kept';
          
          if (!dry_run && payment.order_id) {
            // Cancel only the erroneous order
            await supabaseAdmin
              .from("orders_v2")
              .update({
                status: 'cancelled',
                meta: {
                  cancelled_at: new Date().toISOString(),
                  cancel_reason: 'Payment was invalid (reconciliation fix)',
                },
              })
              .eq("id", payment.order_id);
            ordersСancelled = 1;
          }
          fixed++;
        } else {
          // No other valid access - revoke everything
          actionTaken = 'access_revoked';
          
          if (!dry_run) {
            // Cancel order if exists
            if (payment.order_id) {
              await supabaseAdmin
                .from("orders_v2")
                .update({
                  status: 'cancelled',
                  meta: {
                    cancelled_at: new Date().toISOString(),
                    cancel_reason: 'Payment was invalid (reconciliation fix)',
                  },
                })
                .eq("id", payment.order_id);
              ordersСancelled = 1;
            }

            // Disable subscriptions
            if (subscriptionIds.length > 0) {
              await supabaseAdmin
                .from("subscriptions_v2")
                .update({
                  auto_renew: false,
                  status: 'cancelled',
                  meta: {
                    cancelled_at: new Date().toISOString(),
                    cancel_reason: 'Original payment was invalid',
                  },
                })
                .in("id", subscriptionIds);
              subscriptionsDisabled = subscriptionIds.length;
            }

            // Revoke entitlements linked to this payment's order
            const entitlementsToRevoke = (entitlements || []).filter(e => e.order_id === payment.order_id);
            if (entitlementsToRevoke.length > 0) {
              await supabaseAdmin
                .from("entitlements")
                .update({
                  status: 'revoked',
                  meta: {
                    revoked_at: new Date().toISOString(),
                    revoke_reason: 'Linked payment was invalid',
                  },
                })
                .in("id", entitlementsToRevoke.map(e => e.id));
              entitlementsRevoked = entitlementsToRevoke.length;
            }
          }
          fixed++;
        }

        cases.push({
          uid,
          payment_id: payment.id,
          contact_email: contactEmail,
          contact_name: contactName,
          action_taken: actionTaken,
          has_other_valid_access: hasOtherValidAccess,
          details: {
            payment_status_before: payment.status,
            payment_status_after: actionTaken === 'type_fixed' ? payment.status : (dry_run ? payment.status : 'cancelled'),
            payment_type_before: payment.transaction_type,
            payment_type_after: needsTypeChange ? 'refund' : payment.transaction_type,
            order_ids: orderIds,
            subscription_ids: subscriptionIds,
            entitlement_ids: entitlementIds,
            orders_cancelled: ordersСancelled,
            subscriptions_disabled: subscriptionsDisabled,
            entitlements_revoked: entitlementsRevoked,
          },
          reason: needsTypeChange 
            ? 'Negative amount with payment type - changed to refund'
            : hasOtherValidAccess 
              ? 'User has other valid access - order cancelled, access kept'
              : 'No other valid access - all access revoked',
        });

        auditActions.push(dry_run ? 'payment.fix_case_dry_run' : 'payment.fix_case_executed');

      } catch (caseError: any) {
        errors.push(`UID ${uid}: ${caseError.message}`);
        skipped++;
      }
    }

    // Log audit entry
    if (!dry_run && fixed > 0) {
      await supabaseAdmin.from("audit_logs").insert({
        action: 'payment.fix_false_payments_batch',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-fix-false-payments',
        meta: {
          requested_by_user_id: user.id,
          requested_by_email: user.email,
          total_fixed: fixed,
          total_skipped: skipped,
          dry_run: false,
          uids: uidsToProcess,
        },
      });
    }

    const result: FixResult = {
      success: true,
      dry_run,
      stats: {
        total_requested: payment_uids.length,
        found: cases.filter(c => c.action_taken !== 'not_found').length,
        fixed,
        skipped,
        errors: errors.length,
      },
      cases,
      audit_actions: auditActions,
      errors,
    };

    console.log(`[admin-fix-false-payments] Complete: fixed=${fixed}, skipped=${skipped}, errors=${errors.length}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[admin-fix-false-payments] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
