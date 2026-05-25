import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { endOfDayAppTz } from '../_shared/timezone.ts';

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

// PATCH-B: Multi-path truth extraction helper
function pickFirst(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v != null && v !== '' && typeof v === 'string') return v;
  }
  return null;
}

// UUID regex for parsing tracking_id
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBV2_RE = /subv2:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

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
      // PATCH: return HTTP 200 with structured signal so supabase.functions.invoke
      // does not throw and crash the UI. 404 → not_found, 5xx → fallback.
      const notFound = response.status === 404;
      const isFallbackable = response.status >= 500;
      return new Response(JSON.stringify({
        ok: false,
        error: notFound
          ? 'Subscription not found in bePaid'
          : 'Failed to fetch subscription from bePaid',
        not_found: notFound,
        fallback: isFallbackable,
        upstream_status: response.status,
        details: text.substring(0, 500),
        subscription_id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const sub = data.subscription || data;

    // PATCH-C/H: Normalize state
    const normalizedState = normalizeStatus(sub.state || sub.status);

    // PATCH-B PRE-STAGE: Extract truth from API only (no raw_data yet)
    const preTruthNextCharge = pickFirst(
      sub.renew_at, sub.next_billing_at,
      sub.subscription?.renew_at, sub.subscription?.next_billing_at,
      data.renew_at, data.next_billing_at
    );
    const preTruthAccessEnd = pickFirst(
      sub.active_to, sub.valid_till,
      sub.subscription?.active_to, sub.subscription?.valid_till,
      data.active_to, data.valid_till
    );

    // Build snapshot with PRE truth + diagnostic raw_keys
    const snapshot = {
      id: sub.id,
      state: normalizedState,
      raw_state: sub.state || sub.status,
      next_billing_at: sub.next_billing_at,
      renew_at: preTruthNextCharge,
      active_to: preTruthAccessEnd,
      valid_till: sub.valid_till,
      last_payment_at: sub.last_payment_at,
      last_payment_status: sub.last_transaction?.status,
      last_payment_error: sub.last_transaction?.message,
      is_cancelable: normalizedState !== 'canceled' && normalizedState !== 'terminated',
      plan: sub.plan,
      customer: sub.customer,
      credit_card: sub.credit_card,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
      raw_keys: Object.keys(sub),
    };

    // PATCH-C: Determine cancellation_capability correctly
    let cancellation_capability: 'can_cancel_now' | 'cannot_cancel_until_paid' | 'unknown' | 'not_applicable' = 'unknown';
    if (normalizedState === 'canceled' || normalizedState === 'terminated') {
      cancellation_capability = 'not_applicable';
    } else if (normalizedState === 'active' || normalizedState === 'trial') {
      cancellation_capability = 'can_cancel_now';
    }

    // PATCH-B1: Fetch existingPs with raw_data for truth fallback
    const { data: existingPs } = await supabase
      .from('provider_subscriptions')
      .select('meta, subscription_v2_id, user_id, raw_data')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', subscription_id)
      .maybeSingle();

    if (existingPs) {
      // ===== PATCH-A: AUTOLINK subscription_v2_id =====
      // PATCH 1d: Use effectiveSubV2Id instead of mutating existingPs
      let effectiveSubV2Id = existingPs.subscription_v2_id;
      let linkedSubV2Id = existingPs.subscription_v2_id;

      if (!linkedSubV2Id) {
        console.log(`[autolink] Starting autolink for ${subscription_id}`);
        const rawData = (existingPs.raw_data as Record<string, any>) || {};
        let autolinkSource: string | null = null;

        // Priority 1: tracking_id → subv2:{uuid}
        const trackingId = pickFirst(
          sub.tracking_id, sub.subscription?.tracking_id, sub.additional_data?.tracking_id,
          rawData.tracking_id, (existingPs.meta as any)?.tracking_id
        );

        if (trackingId) {
          const subv2Match = SUBV2_RE.exec(trackingId);
          if (subv2Match) {
            const { data: directSub, error: directSubError } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .eq('id', subv2Match[1])
              .maybeSingle();
            if (directSubError) {
              console.error(`[autolink] Priority 1 query error:`, directSubError.message);
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_query_error',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, priority: 1, error: directSubError.message },
              });
            }
            if (directSub) {
              linkedSubV2Id = directSub.id;
              autolinkSource = 'tracking_id_subv2';
            }
          }

          // Priority 2: tracking_id → {order_uuid}_{offer_uuid}
          if (!linkedSubV2Id) {
            const parts = trackingId.split('_');
            if (parts.length >= 1 && UUID_RE.test(parts[0])) {
              const parsedOrderId = parts[0];
              const { data: orderSubs, error: orderSubsError } = await supabase
                .from('subscriptions_v2')
                .select('id')
                .eq('order_id', parsedOrderId)
                .limit(2);
              if (orderSubsError) {
                console.error(`[autolink] Priority 2 query error:`, orderSubsError.message);
                await supabase.from('audit_logs').insert({
                  action: 'bepaid.sync.autolink_query_error',
                  actor_type: 'system',
                  actor_label: 'bepaid-get-subscription-details',
                  meta: { subscription_id, priority: 2, error: orderSubsError.message },
                });
              } else if (orderSubs && orderSubs.length === 1) {
                linkedSubV2Id = orderSubs[0].id;
                autolinkSource = 'tracking_id_order';
              } else if (orderSubs && orderSubs.length > 1) {
                await supabase.from('audit_logs').insert({
                  action: 'bepaid.sync.autolink_ambiguous',
                  actor_type: 'system',
                  actor_label: 'bepaid-get-subscription-details',
                  meta: { subscription_id, source: 'tracking_id_order', candidates: orderSubs.length, order_id: parsedOrderId },
                });
              }
            }
          }
        }

        // Priority 3: additional_data.order_id
        if (!linkedSubV2Id) {
          const additionalOrderId = pickFirst(
            sub.additional_data?.order_id, sub.subscription?.additional_data?.order_id,
            rawData.additional_data?.order_id, (existingPs.meta as any)?.order_id
          );
          if (additionalOrderId && UUID_RE.test(additionalOrderId)) {
            const { data: orderSubs, error: orderSubsError } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .eq('order_id', additionalOrderId)
              .limit(2);
            if (orderSubsError) {
              console.error(`[autolink] Priority 3 query error:`, orderSubsError.message);
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_query_error',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, priority: 3, error: orderSubsError.message },
              });
            } else if (orderSubs && orderSubs.length === 1) {
              linkedSubV2Id = orderSubs[0].id;
              autolinkSource = 'additional_data_order_id';
            } else if (orderSubs && orderSubs.length > 1) {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_ambiguous',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, source: 'additional_data_order_id', candidates: orderSubs.length },
              });
            }
          }
        }

        // Priority 4: user_id + product_id fallback (PATCH 1a: removed 'pending' from enum)
        if (!linkedSubV2Id && existingPs.user_id) {
          const productId = pickFirst(
            sub.additional_data?.product_id, sub.subscription?.additional_data?.product_id,
            rawData.additional_data?.product_id
          );
          if (!productId) {
            await supabase.from('audit_logs').insert({
              action: 'bepaid.sync.autolink_failed_no_product_id',
              actor_type: 'system',
              actor_label: 'bepaid-get-subscription-details',
              meta: { subscription_id, user_id: existingPs.user_id },
            });

            // Priority 4b: user_id only — single active subscription
            const { data: userSubs, error: userSubsError } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .eq('user_id', existingPs.user_id)
              .in('status', ['active', 'trial', 'past_due'])
              .order('created_at', { ascending: false })
              .limit(2);

            if (userSubsError) {
              console.error(`[autolink] Priority 4b query error:`, userSubsError.message);
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_query_error',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, priority: 5, autolink_source: 'user_only_single_sub', error: userSubsError.message },
              });
            } else if (userSubs && userSubs.length === 1) {
              linkedSubV2Id = userSubs[0].id;
              autolinkSource = 'user_only_single_sub';
            } else if (userSubs && userSubs.length !== 1) {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_ambiguous_or_none',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, user_id: existingPs.user_id, candidates: userSubs?.length ?? 0 },
              });
            }
          } else {
            // PATCH 1a: removed 'pending' — invalid enum value
            const { data: candidates, error: candidatesError } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .eq('user_id', existingPs.user_id)
              .eq('product_id', productId)
              .in('status', ['active', 'trial', 'past_due'])
              .order('created_at', { ascending: false })
              .limit(2);

            // PATCH 1b: mandatory error logging
            if (candidatesError) {
              console.error(`[autolink] Priority 4 query error:`, candidatesError.message);
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_query_error',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, priority: 4, error: candidatesError.message, user_id: existingPs.user_id, product_id: productId },
              });
            } else if (candidates && candidates.length === 1) {
              linkedSubV2Id = candidates[0].id;
              autolinkSource = 'user_product_fallback';
            } else if (candidates && candidates.length === 0) {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_failed_no_candidates',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, user_id: existingPs.user_id, product_id: productId },
              });
            } else if (candidates && candidates.length > 1) {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.autolink_ambiguous',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { subscription_id, source: 'user_product_fallback', candidates: candidates.length, product_id: productId },
              });
            }
          }
        }

        // Apply autolink
        if (linkedSubV2Id && autolinkSource) {
          await supabase
            .from('provider_subscriptions')
            .update({
              subscription_v2_id: linkedSubV2Id,
              meta: {
                ...((existingPs.meta as Record<string, unknown>) || {}),
                autolink: { source: autolinkSource, linked_at: new Date().toISOString(), subscription_v2_id: linkedSubV2Id },
              },
            })
            .eq('provider', 'bepaid')
            .eq('provider_subscription_id', subscription_id);

          // Normalize billing_type
          const { data: linkedSub } = await supabase
            .from('subscriptions_v2')
            .select('billing_type')
            .eq('id', linkedSubV2Id)
            .maybeSingle();
          if (linkedSub && linkedSub.billing_type !== 'provider_managed') {
            await supabase
              .from('subscriptions_v2')
              .update({ billing_type: 'provider_managed' })
              .eq('id', linkedSubV2Id);
            await supabase.from('audit_logs').insert({
              action: 'bepaid.sync.billing_type_corrected',
              actor_type: 'system',
              actor_label: 'bepaid-get-subscription-details',
              meta: { subscription_v2_id: linkedSubV2Id, old: linkedSub.billing_type, new: 'provider_managed' },
            });
          }

          await supabase.from('audit_logs').insert({
            action: 'bepaid.sync.autolinked_subscription_v2',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            target_user_id: existingPs.user_id || null,
            meta: { subscription_id, subscription_v2_id: linkedSubV2Id, source: autolinkSource },
          });

          console.log(`[autolink] Linked ${subscription_id} → ${linkedSubV2Id} via ${autolinkSource}`);
          // PATCH 1d: Update effectiveSubV2Id (not existingPs)
          effectiveSubV2Id = linkedSubV2Id;
        } else if (!linkedSubV2Id) {
          await supabase.from('audit_logs').insert({
            action: 'bepaid.sync.autolink_failed',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            meta: { subscription_id, user_id: existingPs.user_id, tracking_id: trackingId || null },
          });
          console.warn(`[autolink] Failed to autolink ${subscription_id}`);
        }
      }
      // ===== END PATCH-A =====

      // ===== PATCH-B POST-STAGE: FINAL truth with raw_data fallback =====
      const rawData = (existingPs.raw_data as Record<string, any>) || {};
      const truthNextCharge = pickFirst(
        sub.renew_at, sub.next_billing_at,
        sub.subscription?.renew_at, sub.subscription?.next_billing_at,
        data.renew_at, data.next_billing_at,
        rawData.renew_at, rawData.next_billing_at
      );
      const truthAccessEnd = pickFirst(
        sub.active_to, sub.valid_till,
        sub.subscription?.active_to, sub.subscription?.valid_till,
        data.active_to, data.valid_till,
        rawData.active_to, rawData.valid_till
      );

      // Update snapshot with FINAL truth
      snapshot.renew_at = truthNextCharge;
      snapshot.active_to = truthAccessEnd;

      const truthSourceMap: Record<string, string> = {};
      if (truthNextCharge) {
        truthSourceMap.next_charge = sub.renew_at ? 'api.renew_at' : sub.next_billing_at ? 'api.next_billing_at' : 'raw_data';
      }
      if (truthAccessEnd) {
        truthSourceMap.access_end = sub.active_to ? 'api.active_to' : sub.valid_till ? 'api.valid_till' : 'raw_data';
      }

      console.log(`[truth] ${subscription_id}: next_charge=${truthNextCharge}, access_end=${truthAccessEnd}, sources=${JSON.stringify(truthSourceMap)}`);

      // Merge old meta with new snapshot
      const oldMeta = (existingPs.meta as Record<string, unknown>) || {};
      const newMeta = {
        ...oldMeta,
        provider_snapshot: { ...snapshot, truth_source_map: truthSourceMap },
        snapshot_at: new Date().toISOString(),
        cancellation_capability,
      };

      // PATCH-B4: Update provider_subscriptions with truth next_charge_at UNCONDITIONALLY
      const { error: updateError } = await supabase
        .from('provider_subscriptions')
        .update({ 
          state: normalizedState,
          next_charge_at: truthNextCharge,
          meta: newMeta,
        })
        .eq('provider', 'bepaid')
        .eq('provider_subscription_id', subscription_id);

      if (updateError) {
        console.error(`[bepaid-get-subscription-details] Update error:`, updateError);
      }

      // PATCH-B5: STOP-guard for missing truth
      if (!truthNextCharge && !truthAccessEnd) {
        await supabase.from('audit_logs').insert({
          action: 'bepaid.sync.missing_truth_fields',
          actor_type: 'system',
          actor_label: 'bepaid-get-subscription-details',
          meta: { subscription_id, raw_keys: Object.keys(sub), has_raw_data: !!rawData.renew_at },
        });
        console.warn(`[truth] All truth fields null for ${subscription_id}, skipping date propagation`);
      }

      // PATCH 2: Propagate truth dates to subscriptions_v2 (uses effectiveSubV2Id)
      if (effectiveSubV2Id && (truthNextCharge || truthAccessEnd)) {
        const subV2Updates: Record<string, any> = { updated_at: new Date().toISOString() };
        
        if (truthNextCharge) {
          subV2Updates.next_charge_at = truthNextCharge;
        }
        if (truthAccessEnd) {
          subV2Updates.access_end_at = endOfDayAppTz(truthAccessEnd);
        }

        // Read old values for audit + status restoration check
        const { data: oldSubV2 } = await supabase
          .from('subscriptions_v2')
          .select('next_charge_at, access_end_at, status, auto_renew')
          .eq('id', effectiveSubV2Id)
          .maybeSingle();

        // PATCH-A: Restore status to 'active' if subscription was expired/past_due
        // but access_end_at is being extended into the future (renewal payment received)
        const effectiveAccessEnd = subV2Updates.access_end_at || oldSubV2?.access_end_at;
        const currentStatus = oldSubV2?.status;
        const restoredStatuses = ['expired', 'past_due'];
        // Read billing_type for safeguard — only restore provider_managed subscriptions
        const { data: billingCheck } = await supabase
          .from('subscriptions_v2')
          .select('billing_type')
          .eq('id', effectiveSubV2Id)
          .maybeSingle();
        const isProviderManaged = billingCheck?.billing_type === 'provider_managed';
        if (
          isProviderManaged &&
          currentStatus &&
          restoredStatuses.includes(currentStatus) &&
          effectiveAccessEnd &&
          new Date(effectiveAccessEnd) > new Date()
        ) {
          subV2Updates.status = 'active';
          // Also restore auto_renew if it was false — bePaid is still charging
          if (oldSubV2?.auto_renew === false) {
            subV2Updates.auto_renew = true;
          }
          console.log(`[bepaid-get-subscription-details] PATCH-A: Restoring status from '${currentStatus}' to 'active' for ${effectiveSubV2Id}`);

          await supabase.from('audit_logs').insert({
            action: 'bepaid.subscription.status_restored',
            actor_type: 'system',
            actor_label: 'bepaid-get-subscription-details',
            target_user_id: existingPs.user_id || null,
            meta: {
              subscription_v2_id: effectiveSubV2Id,
              provider_subscription_id: subscription_id,
              old_status: currentStatus,
              new_status: 'active',
              old_auto_renew: oldSubV2?.auto_renew,
              new_auto_renew: true,
              access_end_at: effectiveAccessEnd,
              reason: 'sync detected access_end_at in future with expired/past_due status',
            },
          });
        }

        await supabase
          .from('subscriptions_v2')
          .update(subV2Updates)
          .eq('id', effectiveSubV2Id);

        // Audit log
        await supabase.from('audit_logs').insert({
          action: 'bepaid.subscription.sync_dates',
          actor_type: 'system',
          actor_label: 'bepaid-get-subscription-details',
          target_user_id: existingPs.user_id || null,
          meta: {
            subscription_v2_id: effectiveSubV2Id,
            provider_subscription_id: subscription_id,
            old: { next_charge_at: oldSubV2?.next_charge_at, access_end_at: oldSubV2?.access_end_at },
            new: { next_charge_at: subV2Updates.next_charge_at || null, access_end_at: subV2Updates.access_end_at || null },
            truth: { renew_at: truthNextCharge, active_to: truthAccessEnd },
            truth_source_map: truthSourceMap,
          },
        });

        console.log(`[bepaid-get-subscription-details] Synced dates to subscriptions_v2 ${effectiveSubV2Id}`);

        // ===== PATCH-C: APPLY ACCESS CHAIN =====
        if (truthAccessEnd) {
          const accessEndAt = endOfDayAppTz(truthAccessEnd);

          // C1: Read product info
          const { data: subV2Full } = await supabase
            .from('subscriptions_v2')
            .select('user_id, product_id, products_v2(id, code)')
            .eq('id', effectiveSubV2Id)
            .maybeSingle();

          const productId = subV2Full?.product_id;
          const productCode = (subV2Full?.products_v2 as any)?.code;
          const chainUserId = subV2Full?.user_id;

          if (!productId || !chainUserId) {
            await supabase.from('audit_logs').insert({
              action: 'bepaid.sync.access_chain_skipped',
              actor_type: 'system',
              actor_label: 'bepaid-get-subscription-details',
              meta: { subscription_id, subscription_v2_id: effectiveSubV2Id, reason: !productId ? 'no_product_id' : 'no_user_id' },
            });
          } else if (!productCode) {
            // STOP: product_code required for entitlement insert
            await supabase.from('audit_logs').insert({
              action: 'bepaid.sync.access_chain_skipped_no_product_code',
              actor_type: 'system',
              actor_label: 'bepaid-get-subscription-details',
              meta: { subscription_id, product_id: productId },
            });
          } else {
            // C2: Entitlements upsert by (user_id, product_id)
            const { data: existingEnt } = await supabase
              .from('entitlements')
              .select('id, expires_at')
              .eq('user_id', chainUserId)
              .eq('product_id', productId)
              .maybeSingle();

            if (existingEnt) {
              const currentExpires = existingEnt.expires_at ? new Date(existingEnt.expires_at).getTime() : 0;
              const newExpires = new Date(accessEndAt).getTime();
              if (newExpires > currentExpires) {
                await supabase
                  .from('entitlements')
                  .update({ expires_at: accessEndAt, status: 'active' })
                  .eq('id', existingEnt.id);
                console.log(`[access-chain] Extended entitlement ${existingEnt.id} to ${accessEndAt}`);
              }
            } else {
              // Get profile_id for entitlement
              const { data: profile } = await supabase
                .from('profiles')
                .select('id')
                .eq('user_id', chainUserId)
                .maybeSingle();

              await supabase
                .from('entitlements')
                .insert({
                  user_id: chainUserId,
                  product_id: productId,
                  product_code: productCode,
                  status: 'active',
                  expires_at: accessEndAt,
                  profile_id: profile?.id || null,
                });
              console.log(`[access-chain] Created entitlement for ${chainUserId}/${productId}`);
            }

            await supabase.from('audit_logs').insert({
              action: 'bepaid.sync.entitlement_extended',
              actor_type: 'system',
              actor_label: 'bepaid-get-subscription-details',
              target_user_id: chainUserId,
              meta: { product_id: productId, access_end_at: accessEndAt, existed: !!existingEnt },
            });

            // C3: Telegram grants — extend latest active (via access_rules SoT)
            const { data: clubRules } = await supabase
              .from('access_rules')
              .select('id, target_ref')
              .eq('product_id', productId)
              .eq('grant_target_type', 'club')
              .eq('is_active', true);

            if (!clubRules || clubRules.length === 0) {
              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.no_club_rule',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                meta: { product_id: productId, subscription_id },
              });
            } else {
              for (const rule of clubRules) {
                const clubId = rule.target_ref;
                if (!clubId) continue;
                const { data: latestGrant } = await supabase
                  .from('telegram_access_grants')
                  .select('id, end_at')
                  .eq('user_id', chainUserId)
                  .eq('club_id', clubId)
                  .in('status', ['active', 'granted'])
                  .order('end_at', { ascending: false, nullsFirst: false })
                  .limit(1)
                  .maybeSingle();

                if (latestGrant) {
                  const currentEnd = latestGrant.end_at ? new Date(latestGrant.end_at).getTime() : 0;
                  const newEnd = new Date(accessEndAt).getTime();
                  if (newEnd > currentEnd) {
                    await supabase
                      .from('telegram_access_grants')
                      .update({ end_at: accessEndAt })
                      .eq('id', latestGrant.id);
                    console.log(`[access-chain] Extended telegram grant ${latestGrant.id} to ${accessEndAt}`);
                  }
                } else {
                  await supabase
                    .from('telegram_access_grants')
                    .insert({
                      user_id: chainUserId,
                      club_id: clubId,
                      source: 'bepaid_sync',
                      source_id: subscription_id,
                      status: 'active',
                      start_at: new Date().toISOString(),
                      end_at: accessEndAt,
                    });
                  console.log(`[access-chain] Created telegram grant for ${chainUserId}/${clubId}`);
                }
              }

              await supabase.from('audit_logs').insert({
                action: 'bepaid.sync.access_chain_applied',
                actor_type: 'system',
                actor_label: 'bepaid-get-subscription-details',
                target_user_id: chainUserId,
                meta: {
                  subscription_id,
                  subscription_v2_id: effectiveSubV2Id,
                  access_end_at: accessEndAt,
                  clubs: clubRules.map(r => r.target_ref),
                },
              });
            }
          }
        }
        // ===== END PATCH-C =====
      } else if (!effectiveSubV2Id && (truthNextCharge || truthAccessEnd)) {
        // PATCH 2: Log skip when no sub_v2 is linked
        await supabase.from('audit_logs').insert({
          action: 'bepaid.sync.skip_propagation_no_subv2',
          actor_type: 'system',
          actor_label: 'bepaid-get-subscription-details',
          meta: { provider_subscription_id: subscription_id, user_id: existingPs.user_id },
        });
        console.warn(`[bepaid-get-subscription-details] No sub_v2 linked, skipping propagation for ${subscription_id}`);
      } else if (effectiveSubV2Id && !truthNextCharge && !truthAccessEnd) {
        // Already logged missing_truth_fields above
        console.warn(`[bepaid-get-subscription-details] No truth fields from bePaid for ${subscription_id}`);
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

        if (!resolvedUserId && effectiveSubV2Id) {
          const { data: subV2 } = await supabase
            .from('subscriptions_v2')
            .select('user_id')
            .eq('id', effectiveSubV2Id)
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
