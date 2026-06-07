import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// PATCH-G: Reason codes for cancel failures
// Hotfix-2 (Phase 8 plan §HOTFIX-2): добавлен код provider_subscription_not_found_treated_as_canceled,
//   когда bePaid отвечает 404, а локально подписка ещё active/pending/past_due — это replace/cancel
//   flow, и удалённого объекта уже нет; считаем cancel успешным (НЕ блокируем replacement).
type CancelReasonCode =
  | 'cannot_cancel_until_paid'
  | 'not_found'
  | 'already_canceled'
  | 'api_error'
  | 'unknown'
  | 'provider_subscription_not_found_treated_as_canceled';

interface CancelFailure {
  id: string;
  error: string;
  reason_code: CancelReasonCode;
  http_status?: number;
  provider_error?: string;
}

interface RemoteMissingEntry {
  id: string;
  reason_code: 'provider_subscription_not_found_treated_as_canceled';
  http_status: 404;
  local_state: string | null;
}

interface CancelResult {
  canceled: string[];  // Use 'canceled' (correct spelling)
  failed: CancelFailure[];
  // Hotfix-2: подписки, которых нет в bePaid, но локально были active/pending/past_due —
  // помечаем canceled локально и сообщаем клиенту явно через этот массив.
  remote_missing: RemoteMissingEntry[];
  total_requested: number;
}

interface CancelRequest {
  subscription_ids?: string[];           // bePaid subscription IDs
  provider_subscription_ids?: string[];  // Alias for subscription_ids
  subscription_v2_id?: string;           // Our subscription ID - will find and cancel linked provider sub
  source?: string;                       // 'user_self_cancel' | 'admin_cancel'
}

// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

// PATCH-G: Determine reason_code from error response
function determineReasonCode(httpStatus: number, errorText: string, localState?: string): CancelReasonCode {
  if (httpStatus === 404) {
    // Check if already canceled or not found
    if (localState === 'canceled' || localState === 'cancelled' || localState === 'terminated') {
      return 'already_canceled';
    }
    return 'not_found';
  }
  
  // Only set cannot_cancel_until_paid if we have clear evidence
  // Look for specific known phrases from bePaid API
  const lowerError = errorText.toLowerCase();
  if (
    lowerError.includes('cannot cancel') && 
    (lowerError.includes('payment') || lowerError.includes('past_due') || lowerError.includes('failed payment'))
  ) {
    return 'cannot_cancel_until_paid';
  }
  
  return 'api_error';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
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
    const hasAdminRole = hasAdmin === true || hasSuperAdmin === true;

    const body: CancelRequest = await req.json();
    const source = body.source || (hasAdminRole ? 'admin_cancel' : 'user_self_cancel');
    
    // Collect subscription IDs to cancel
    let subscriptionIds: string[] = [];
    let targetUserId: string | null = null;

    // Option 1: Direct bePaid subscription IDs
    if (body.subscription_ids?.length) {
      subscriptionIds = body.subscription_ids;
    } else if (body.provider_subscription_ids?.length) {
      subscriptionIds = body.provider_subscription_ids;
    }
    
    // Option 2: Find by subscription_v2_id
    if (body.subscription_v2_id) {
      const { data: provSubs } = await supabase
        .from('provider_subscriptions')
        .select('provider_subscription_id, user_id')
        .eq('subscription_v2_id', body.subscription_v2_id)
        .in('state', ['active', 'pending', 'trial']);

      if (provSubs?.length) {
        subscriptionIds.push(...provSubs.map((s: any) => s.provider_subscription_id));
        targetUserId = provSubs[0].user_id;
      }
    }

    if (subscriptionIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No subscription IDs provided or found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // RBAC: Non-admins can only cancel their own subscriptions
    if (!hasAdminRole) {
      // Verify ownership of all subscriptions
      const { data: ownedSubs } = await supabase
        .from('provider_subscriptions')
        .select('provider_subscription_id')
        .in('provider_subscription_id', subscriptionIds)
        .eq('user_id', user.id);

      const ownedIds = new Set(ownedSubs?.map((s: any) => s.provider_subscription_id) || []);
      const notOwnedIds = subscriptionIds.filter(id => !ownedIds.has(id));

      if (notOwnedIds.length > 0) {
        console.error(`[bepaid-cancel-subs] User ${user.id} tried to cancel unowned subscriptions:`, notOwnedIds);
        return new Response(JSON.stringify({ 
          error: 'Access denied: Cannot cancel subscriptions you do not own' 
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error('[bepaid-cancel-subs] No credentials found:', credsResult.error);
      return new Response(JSON.stringify({ 
        error: credsResult.error,
        code: 'BEPAID_CREDS_MISSING'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;
    const authString = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');
    // Or simpler: use Authorization header directly
    const authHeaderValue = createBepaidAuthHeader(bepaidCreds);

    const result: CancelResult = {
      canceled: [],
      failed: [],
      remote_missing: [],
      total_requested: subscriptionIds.length,
    };

    for (const subId of subscriptionIds) {
      try {
        // Get local state first for determining reason_code
        const { data: localSub } = await supabase
          .from('provider_subscriptions')
          .select('state, meta')
          .eq('provider_subscription_id', subId)
          .maybeSingle();

        // Call bePaid cancel API
        const response = await fetch(`https://api.bepaid.by/subscriptions/${subId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: authHeaderValue,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ cancel_reason: source === 'user_self_cancel' ? 'cancelled_by_customer' : 'cancelled_by_admin' }),
        });

        let shouldMarkCanceled = false;
        let failReason: CancelFailure | null = null;

        if (response.ok) {
          // Direct success from bePaid
          shouldMarkCanceled = true;
          console.log(`[bepaid-cancel-subs] Cancelled subscription ${subId}`);
        } else if (response.status === 404) {
          // PATCH-5: 404 handling — check local state before marking as success.
          const localState = (localSub?.state as string | undefined) ?? null;
          const alreadyDeadLocal =
            !!localSub && (localState === 'canceled' || localState === 'cancelled' || localState === 'terminated');
          const activeOrPendingLocal =
            !!localSub && (localState === 'active' || localState === 'pending' || localState === 'past_due');

          if (alreadyDeadLocal) {
            // Already non-active locally — treat as success (existing behaviour).
            shouldMarkCanceled = true;
            console.log(`[bepaid-cancel-subs] ${subId} returned 404, local already ${localState}`);
          } else if (activeOrPendingLocal) {
            // Hotfix-2 (Phase 8 plan §HOTFIX-2):
            //   bePaid говорит «нет такой подписки», а локально она ещё active/pending/past_due.
            //   В рамках cancel/replace flow это означает, что удалённого объекта уже нет
            //   и cancel — фактический no-op. Считаем cancel успешным, помечаем remote_missing,
            //   НЕ блокируем replacement.
            shouldMarkCanceled = true;
            result.remote_missing.push({
              id: subId,
              reason_code: 'provider_subscription_not_found_treated_as_canceled',
              http_status: 404,
              local_state: localState,
            });
            console.warn(
              `[bepaid-cancel-subs] ${subId} → 404 + local ${localState} → treat as canceled (remote_missing)`,
            );
          } else {
            // Unknown local state — оставляем строгое поведение, чтобы не маскировать рассинхрон.
            const reasonCode = determineReasonCode(404, '', localState ?? undefined);
            failReason = {
              id: subId,
              error: '404: subscription not found in bePaid',
              reason_code: reasonCode,
              http_status: 404,
            };
            console.warn(`[bepaid-cancel-subs] ${subId} returned 404, local state=${localState ?? 'unknown'}`);
          }
        } else {
          const errText = await response.text();
          const reasonCode = determineReasonCode(response.status, errText, localSub?.state);
          
          failReason = {
            id: subId,
            error: `${response.status}: ${errText.slice(0, 200)}`,
            reason_code: reasonCode,
            http_status: response.status,
            provider_error: errText.slice(0, 500),
          };
          console.error(`[bepaid-cancel-subs] Failed to cancel ${subId}:`, response.status, reasonCode);
        }

        if (shouldMarkCanceled) {
          result.canceled.push(subId);

          // Update provider_subscriptions with normalized state
          await supabase
            .from('provider_subscriptions')
            .update({
              state: 'canceled',  // Use 'canceled' (normalized)
            })
            .eq('provider_subscription_id', subId);

          // Update linked subscriptions_v2
          const { data: linkedSubs } = await supabase
            .from('provider_subscriptions')
            .select('subscription_v2_id, user_id')
            .eq('provider_subscription_id', subId);

          for (const linked of linkedSubs || []) {
            if (linked.subscription_v2_id) {
              const { data: subV2 } = await supabase
                .from('subscriptions_v2')
                .select('meta')
                .eq('id', linked.subscription_v2_id)
                .single();

              await supabase
                .from('subscriptions_v2')
                .update({
                  auto_renew: false,
                  canceled_at: new Date().toISOString(),
                  meta: {
                    ...((subV2?.meta as object) || {}),
                    bepaid_canceled_at: new Date().toISOString(),  // Use 'canceled'
                    bepaid_canceled_by: user.id,
                    bepaid_cancel_source: source,
                  },
                })
                .eq('id', linked.subscription_v2_id);
            }

            // Set targetUserId for audit
            if (!targetUserId && linked.user_id) {
              targetUserId = linked.user_id;
            }
          }
        } else if (failReason) {
          result.failed.push(failReason);

          // PATCH-G: For 'cannot_cancel_until_paid', save needs_support flag
          if (failReason.reason_code === 'cannot_cancel_until_paid') {
            // Read-modify-write for meta
            const oldMeta = (localSub?.meta as Record<string, unknown>) || {};
            const newMeta = {
              ...oldMeta,
              cancellation_capability: 'cannot_cancel_until_paid',
              needs_support: true,
              cancel_block_reason: failReason.provider_error || failReason.error,
              cancel_blocked_at: new Date().toISOString(),
            };

            await supabase
              .from('provider_subscriptions')
              .update({ meta: newMeta })
              .eq('provider_subscription_id', subId);

            console.log(`[bepaid-cancel-subs] Marked ${subId} as needs_support`);
          }
        }
      } catch (e: any) {
        result.failed.push({ 
          id: subId, 
          error: e.message, 
          reason_code: 'unknown' 
        });
        console.error(`[bepaid-cancel-subs] Error cancelling ${subId}:`, e.message);
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-cancel-subscription',
      action: 'bepaid.subscription.cancel',
      target_user_id: targetUserId || user.id,
      meta: {
        requested: subscriptionIds.length,
        canceled: result.canceled.length,
        failed: result.failed.length,
        canceled_ids: result.canceled,
        failed_details: result.failed,
        // Hotfix-2: явная трассировка remote_missing для diagnostics.
        remote_missing_count: result.remote_missing.length,
        remote_missing: result.remote_missing,
        source,
        initiator_user_id: user.id,
        is_admin: hasAdminRole,
      },
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[bepaid-cancel-subs] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
