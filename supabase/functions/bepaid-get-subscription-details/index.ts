import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { endOfDayWarsaw } from '../_shared/timezone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// PATCH-H: Centralized status normalization
function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  if (status === 'cancelled') return 'canceled';
  return status;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // RBAC: Only admin allowed
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-A: Check both admin and superadmin (correct enum values)
    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);

    const isAdmin = hasAdmin === true || hasSuperAdmin === true;
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subscription_id } = await req.json();
    if (!subscription_id) {
      return new Response(JSON.stringify({ error: 'subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ error: 'bePaid credentials not configured: ' + credsResult.error, code: 'BEPAID_CREDS_MISSING' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;
    const authString = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

    // Fetch subscription details from bePaid
    const response = await fetch(`https://api.bepaid.by/subscriptions/${subscription_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[bepaid-get-subscription-details] bePaid error: ${response.status} ${text}`);
      // PATCH 2: Audit log on API failure
      await supabase.from('audit_logs').insert({
        action: 'bepaid.sync_failed',
        actor_type: 'system',
        actor_label: 'bepaid-get-subscription-details',
        meta: { subscription_id, status: response.status, error: text.substring(0, 500) },
      });
      return new Response(JSON.stringify({ 
        error: 'Failed to fetch subscription from bePaid',
        status: response.status,
        details: text,
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const sub = data.subscription || data;

    // PATCH-C/H: Normalize state
    const normalizedState = normalizeStatus(sub.state || sub.status);

    // PATCH 2.A: Truth field map
    const truthNextCharge = sub.renew_at || sub.next_billing_at || null;
    const truthAccessEnd = sub.active_to || sub.valid_till || null;

    // Build snapshot
    const snapshot = {
      id: sub.id,
      state: normalizedState,
      raw_state: sub.state || sub.status,
      next_billing_at: sub.next_billing_at,
      renew_at: sub.renew_at,          // PATCH 2.B: add truth fields
      active_to: sub.active_to,        // PATCH 2.B: add truth fields
      valid_till: sub.valid_till,       // PATCH 2.B: add truth fields
      last_payment_at: sub.last_payment_at,
      last_payment_status: sub.last_transaction?.status,
      last_payment_error: sub.last_transaction?.message,
      is_cancelable: normalizedState !== 'canceled' && normalizedState !== 'terminated',
      plan: sub.plan,
      customer: sub.customer,
      credit_card: sub.credit_card,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
    };

    // PATCH-C: Determine cancellation_capability correctly
    let cancellation_capability: 'can_cancel_now' | 'cannot_cancel_until_paid' | 'unknown' | 'not_applicable' = 'unknown';
    if (normalizedState === 'canceled' || normalizedState === 'terminated') {
      cancellation_capability = 'not_applicable';
    } else if (normalizedState === 'active' || normalizedState === 'trial') {
      cancellation_capability = 'can_cancel_now';
    }

    // PATCH-C: Atomic meta update using read-modify-write
    const { data: existingPs } = await supabase
      .from('provider_subscriptions')
      .select('meta, subscription_v2_id, user_id')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', subscription_id)
      .maybeSingle();

    if (existingPs) {
      // Merge old meta with new snapshot
      const oldMeta = (existingPs.meta as Record<string, unknown>) || {};
      const newMeta = {
        ...oldMeta,
        provider_snapshot: snapshot,
        snapshot_at: new Date().toISOString(),
        cancellation_capability,
      };

      // PATCH 2.C: Update provider_subscriptions with truth next_charge_at
      const { error: updateError } = await supabase
        .from('provider_subscriptions')
        .update({ 
          state: normalizedState,
          next_charge_at: truthNextCharge,  // PATCH 2: use truth field
          meta: newMeta,
        })
        .eq('provider', 'bepaid')
        .eq('provider_subscription_id', subscription_id);

      if (updateError) {
        console.error(`[bepaid-get-subscription-details] Update error:`, updateError);
      }

      // PATCH 2.D: Propagate truth dates to subscriptions_v2
      if (existingPs.subscription_v2_id) {
        const subV2Updates: Record<string, any> = { updated_at: new Date().toISOString() };
        
        if (truthNextCharge) {
          subV2Updates.next_charge_at = truthNextCharge;
        }
        if (truthAccessEnd) {
          subV2Updates.access_end_at = endOfDayWarsaw(truthAccessEnd);
        }

        if (truthNextCharge || truthAccessEnd) {
          // Read old values for audit
          const { data: oldSubV2 } = await supabase
            .from('subscriptions_v2')
            .select('next_charge_at, access_end_at')
            .eq('id', existingPs.subscription_v2_id)
            .maybeSingle();

          await supabase
            .from('subscriptions_v2')
            .update(subV2Updates)
            .eq('id', existingPs.subscription_v2_id);

          // Audit log
          await supabase.from('audit_logs').insert({
            action: 'bepaid.subscription.sync_dates',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            target_user_id: existingPs.user_id || null,
            meta: {
              subscription_v2_id: existingPs.subscription_v2_id,
              provider_subscription_id: subscription_id,
              old: { next_charge_at: oldSubV2?.next_charge_at, access_end_at: oldSubV2?.access_end_at },
              new: { next_charge_at: subV2Updates.next_charge_at || null, access_end_at: subV2Updates.access_end_at || null },
              truth: { renew_at: sub.renew_at, next_billing_at: sub.next_billing_at, active_to: sub.active_to, valid_till: sub.valid_till },
            },
          });

          console.log(`[bepaid-get-subscription-details] Synced dates to subscriptions_v2 ${existingPs.subscription_v2_id}`);
        } else {
          console.warn(`[bepaid-get-subscription-details] No truth fields from bePaid for ${subscription_id}`);
        }
      }

      // PATCH 2.E: Upsert last_transaction into payments_v2
      const lastTx = sub.last_transaction;
      if (lastTx?.uid) {
        const txStatus = lastTx.status === 'successful' ? 'succeeded' : 'failed';
        
        // Resolve user_id and profile_id
        let resolvedUserId = existingPs.user_id;
        let resolvedProfileId: string | null = null;

        if (resolvedUserId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', resolvedUserId)
            .maybeSingle();
          resolvedProfileId = profile?.id || null;
        }

        if (!resolvedUserId && existingPs.subscription_v2_id) {
          const { data: subV2 } = await supabase
            .from('subscriptions_v2')
            .select('user_id')
            .eq('id', existingPs.subscription_v2_id)
            .maybeSingle();
          resolvedUserId = subV2?.user_id || null;
          if (resolvedUserId) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('id')
              .eq('user_id', resolvedUserId)
              .maybeSingle();
            resolvedProfileId = profile?.id || null;
          }
        }

        if (!resolvedUserId) {
          // STOP-guard: no user_id resolved
          console.warn(`[bepaid-get-subscription-details] Cannot upsert payment: no user_id for tx ${lastTx.uid}`);
          await supabase.from('audit_logs').insert({
            action: 'bepaid.payment.upsert_skipped_no_user',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            meta: { provider_payment_id: lastTx.uid, provider_subscription_id: subscription_id },
          });
        } else {
          // Check if payment already exists
          const { data: existingPayment } = await supabase
            .from('payments_v2')
            .select('id')
            .eq('provider_payment_id', lastTx.uid)
            .maybeSingle();

          const paymentData: Record<string, any> = {
            provider_payment_id: lastTx.uid,
            provider: 'bepaid',
            user_id: resolvedUserId,
            profile_id: resolvedProfileId,
            status: txStatus,
            amount: lastTx.amount ? lastTx.amount / 100 : null,
            currency: lastTx.currency || 'BYN',
            paid_at: lastTx.created_at || lastTx.paid_at || new Date().toISOString(),
            card_last4: lastTx.credit_card?.last_4 || sub.credit_card?.last_4 || null,
            card_brand: lastTx.credit_card?.brand || sub.credit_card?.brand || null,
            is_recurring: true,
            meta: {
              bepaid_subscription_id: subscription_id,
              synced_from: 'bepaid-get-subscription-details',
              last_transaction_status: lastTx.status,
              last_transaction_message: lastTx.message || null,
            },
          };

          // Add order_id from provider_subscriptions meta if available
          const psMetaOrderId = (existingPs.meta as any)?.order_id;
          if (psMetaOrderId) {
            paymentData.order_id = psMetaOrderId;
          }

          if (existingPayment) {
            await supabase
              .from('payments_v2')
              .update(paymentData)
              .eq('id', existingPayment.id);
            console.log(`[bepaid-get-subscription-details] Updated payment ${existingPayment.id} from last_transaction`);
          } else {
            const { data: newPayment } = await supabase
              .from('payments_v2')
              .insert(paymentData)
              .select('id')
              .maybeSingle();
            console.log(`[bepaid-get-subscription-details] Inserted payment ${newPayment?.id} from last_transaction`);

            // Detect missed webhook
            if (txStatus === 'succeeded') {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.payment.missed_webhook_detected',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                target_user_id: resolvedUserId,
                meta: { provider_payment_id: lastTx.uid, provider_subscription_id: subscription_id },
              });
            }
          }

          // Audit
          await supabase.from('audit_logs').insert({
            action: 'bepaid.payment.upsert_from_last_transaction',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            target_user_id: resolvedUserId,
            meta: { 
              provider_payment_id: lastTx.uid, 
              status: txStatus, 
              provider_subscription_id: subscription_id,
              is_new: !existingPayment,
            },
          });
        }
      }
    }

    console.log(`[bepaid-get-subscription-details] Fetched snapshot for ${subscription_id}: state=${normalizedState}, capability=${cancellation_capability}`);

    return new Response(JSON.stringify({
      success: true,
      subscription_id,
      snapshot,
      is_cancelable: snapshot.is_cancelable,
      cancellation_capability,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[bepaid-get-subscription-details] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
