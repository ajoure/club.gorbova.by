import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { syncEntitlement } from '../_shared/entitlement-sync.ts';

// ============= Resume eligibility (3-level check) =============
// SOT: local state + payment method + provider state.
// Read-only helper — never writes. Used by both `check-resume` and `resume`.
type ResumeReason =
  | 'ok'
  | 'not_needed'
  | 'no_payment_method'
  | 'provider_dead'
  | 'provider_check_failed';

interface ResumeEligibility {
  resume_available: boolean;
  reason: ResumeReason;
  has_card: boolean;
  provider_state: string | null;
  provider_subscription_id: string | null;
  payment_method_id: string | null;
  payment_token: string | null;
  prior_state: 'cancel_scheduled' | 'auto_renew_off_legacy' | 'active_normal';
  cta_product_id: string | null;
  cta_tariff_id: string | null;
}

// deno-lint-ignore no-explicit-any
async function evaluateResumeEligibility(supabase: any, subscription: any, userId: string): Promise<ResumeEligibility> {
  const result: ResumeEligibility = {
    resume_available: false,
    reason: 'ok',
    has_card: false,
    provider_state: null,
    provider_subscription_id: null,
    payment_method_id: null,
    payment_token: null,
    prior_state: 'active_normal',
    cta_product_id: subscription.product_id ?? null,
    cta_tariff_id: subscription.tariff_id ?? null,
  };

  // ---- Level 1: local state ----
  const status = String(subscription.status || '').toLowerCase();
  const cancelAtFuture = subscription.cancel_at && new Date(subscription.cancel_at) > new Date();
  const autoRenewOff = subscription.auto_renew === false;

  if (status !== 'active' && status !== 'trial' && status !== 'trialing') {
    result.reason = 'not_needed';
    return result;
  }
  if (!autoRenewOff && !cancelAtFuture) {
    // Already auto-renewing and no scheduled cancellation → nothing to resume.
    result.reason = 'not_needed';
    return result;
  }

  result.prior_state = cancelAtFuture
    ? 'cancel_scheduled'
    : (autoRenewOff ? 'auto_renew_off_legacy' : 'active_normal');

  // ---- Level 2: payment method ----
  // Prefer the card already linked to the subscription; fall back to user's default active card.
  let pm: { id: string; provider_token: string | null; status: string } | null = null;
  if (subscription.payment_method_id) {
    const { data } = await supabase
      .from('payment_methods')
      .select('id, provider_token, status')
      .eq('id', subscription.payment_method_id)
      .maybeSingle();
    if (data && data.status === 'active' && data.provider_token) {
      pm = data;
    }
  }
  if (!pm) {
    const { data } = await supabase
      .from('payment_methods')
      .select('id, provider_token, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('provider_token', 'is', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) pm = data;
  }

  if (!pm) {
    result.reason = 'no_payment_method';
    return result;
  }
  result.has_card = true;
  result.payment_method_id = pm.id;
  result.payment_token = pm.provider_token;

  // ---- Level 3: provider (bePaid) state ----
  // Check provider_subscriptions for this subv2. If a record exists, its state must be active.
  // If NO provider record exists at all → legacy local-only subscription, allowed (card already validated).
  const { data: providerRows } = await supabase
    .from('provider_subscriptions')
    .select('provider_subscription_id, state, updated_at')
    .eq('subscription_v2_id', subscription.id)
    .eq('provider', 'bepaid')
    .order('updated_at', { ascending: false });

  if (providerRows && providerRows.length > 0) {
    // If ANY linked provider subscription is active → ok.
    const live = providerRows.find((r: any) => {
      const s = String(r.state || '').toLowerCase();
      return s === 'active' || s === 'trial';
    });
    const newest = providerRows[0];
    result.provider_subscription_id = (live ?? newest).provider_subscription_id ?? null;
    result.provider_state = String((live ?? newest).state || '').toLowerCase() || null;

    if (!live) {
      // All linked provider subs are dead (canceled/expired/terminated/failed/...).
      result.reason = 'provider_dead';
      return result;
    }
  }
  // else: no provider record → local-only, fall through to ok.

  result.resume_available = true;
  result.reason = 'ok';
  return result;
}

function eligibilityToHttpError(e: ResumeEligibility): { code: string; message: string } {
  switch (e.reason) {
    case 'no_payment_method':
      return { code: 'resume_blocked_no_payment_method', message: 'Нужно заново привязать карту или оформить новую подписку' };
    case 'provider_dead':
      return { code: 'resume_blocked_provider_dead', message: 'Эту подписку нельзя возобновить, оформите новую' };
    case 'not_needed':
      return { code: 'resume_blocked_not_needed', message: 'Подписка уже активна' };
    case 'provider_check_failed':
      return { code: 'resume_blocked_provider_check_failed', message: 'Не удалось проверить статус подписки у провайдера. Попробуйте позже или оформите новую подписку.' };
    default:
      return { code: 'resume_blocked', message: 'Нельзя возобновить подписку' };
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's auth header for JWT validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await (supabaseAuth.auth as any).getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.error('JWT validation error:', claimsError);
      return new Response(JSON.stringify({ error: 'Invalid JWT' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = claimsData.claims.sub;
    
    // Use service role for database operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { action, subscription_id, payment_method_id } = await req.json();
    console.log(`Subscription action: ${action} for subscription ${subscription_id} by user ${userId}`);

    // Verify subscription belongs to user
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*')
      .eq('id', subscription_id)
      .eq('user_id', userId)
      .single();

    if (subError || !subscription) {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    switch (action) {
      case 'cancel': {
        // Determine cancel_at date
        let cancelAt: string;
        
        if (subscription.is_trial && subscription.trial_end_at) {
          cancelAt = subscription.trial_end_at;
        } else if (subscription.access_end_at) {
          cancelAt = subscription.access_end_at;
        } else {
          // Default to 30 days from now
          const date = new Date();
          date.setDate(date.getDate() + 30);
          cancelAt = date.toISOString();
        }

        // Prepare updated meta with cancel source
        const existingMeta = subscription.meta as Record<string, unknown> || {};
        const newMeta = {
          ...existingMeta,
          cancel_source: 'user',
          cancel_reason: 'Отменено пользователем в ЛК',
          canceled_by_user_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: cancelAt,
            canceled_at: new Date().toISOString(),
            auto_renew: false, // IMPORTANT: disable auto-renew when user cancels
            // PATCH 13+: Track who disabled auto_renew
            auto_renew_disabled_by: 'user',
            auto_renew_disabled_at: new Date().toISOString(),
            auto_renew_disabled_by_user_id: userId,
            meta: newMeta,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Error canceling subscription:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to cancel subscription' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          actor_user_id: userId,
          action: 'subscription.canceled',
          meta: { subscription_id, cancel_at: cancelAt, cancel_source: 'user' },
        });

        console.log(`Subscription ${subscription_id} canceled by user, will end at ${cancelAt}`);
        return new Response(JSON.stringify({ success: true, cancel_at: cancelAt }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'check-resume': {
        const eligibility = await evaluateResumeEligibility(supabase, subscription, userId);
        return new Response(JSON.stringify({
          success: true,
          resume_available: eligibility.resume_available,
          reason: eligibility.reason,
          has_card: eligibility.has_card,
          provider_state: eligibility.provider_state,
          prior_state: eligibility.prior_state,
          cta_product_id: eligibility.cta_product_id,
          cta_tariff_id: eligibility.cta_tariff_id,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'resume': {
        const eligibility = await evaluateResumeEligibility(supabase, subscription, userId);

        if (!eligibility.resume_available) {
          const auditAction =
            eligibility.reason === 'no_payment_method' ? 'subscription.resume_blocked_no_payment_method' :
            eligibility.reason === 'provider_dead'     ? 'subscription.resume_blocked_provider_dead' :
            eligibility.reason === 'not_needed'        ? 'subscription.resume_blocked_not_needed' :
            eligibility.reason === 'provider_check_failed' ? 'subscription.resume_blocked_provider_check_failed' :
            'subscription.resume_blocked';

          await supabase.from('audit_logs').insert({
            actor_user_id: userId,
            action: auditAction,
            target_user_id: subscription.user_id,
            meta: {
              subscription_id,
              user_id: subscription.user_id,
              provider_subscription_id: eligibility.provider_subscription_id,
              payment_method_id: eligibility.payment_method_id,
              block_reason: eligibility.reason,
              provider_state: eligibility.provider_state,
              prior_state: eligibility.prior_state,
              has_card: eligibility.has_card,
            },
          });

          const httpErr = eligibilityToHttpError(eligibility);
          return new Response(JSON.stringify({
            error: httpErr.message,
            code: httpErr.code,
            reason: eligibility.reason,
            cta_product_id: eligibility.cta_product_id,
            cta_tariff_id: eligibility.cta_tariff_id,
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const existingMeta = subscription.meta as Record<string, unknown> || {};
        const newMeta = {
          ...existingMeta,
          cancel_source: null,
          resumed_at: new Date().toISOString(),
          resumed_by_user: true,
          resumed_prior_state: eligibility.prior_state,
        };

        const updateData: Record<string, unknown> = {
          cancel_at: null,
          canceled_at: null,
          auto_renew: true,
          auto_renew_disabled_by: null,
          auto_renew_disabled_at: null,
          auto_renew_disabled_by_user_id: null,
          meta: newMeta,
          updated_at: new Date().toISOString(),
        };
        if (eligibility.payment_method_id) {
          updateData.payment_method_id = eligibility.payment_method_id;
          updateData.payment_token = eligibility.payment_token;
        }

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update(updateData)
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Error resuming subscription:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to resume subscription' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        await supabase.from('audit_logs').insert({
          actor_user_id: userId,
          action: 'subscription.resumed',
          target_user_id: subscription.user_id,
          meta: {
            subscription_id,
            user_id: subscription.user_id,
            auto_renew: true,
            payment_method_id: eligibility.payment_method_id,
            provider_subscription_id: eligibility.provider_subscription_id,
            provider_state: eligibility.provider_state,
            prior_state: eligibility.prior_state,
          },
        });

        console.log(`Subscription ${subscription_id} resumed (prior_state=${eligibility.prior_state})`);

        if (subscription.product_id) {
          try {
            const { data: prdSync } = await supabase.from('products_v2').select('code').eq('id', subscription.product_id).maybeSingle();
            if (prdSync?.code) {
              const { data: profileSync } = await supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle();
              const sr = await syncEntitlement({
                supabase, user_id: userId, profile_id: profileSync?.id || null,
                product_id: subscription.product_id, product_code: prdSync.code,
                access_end_at: subscription.access_end_at, source: 'user_resume',
                subscription_id, actor_label: 'subscription-actions', mode_filter: 'subscription_based',
              });
              console.log(`[subscription-actions] Entitlement sync (resume): ${sr.action}`);
            }
          } catch (e) { console.error('[subscription-actions] Entitlement sync error (resume):', e); }
        }

        return new Response(JSON.stringify({
          success: true,
          auto_renew: true,
          payment_method_linked: !!eligibility.payment_method_id,
          prior_state: eligibility.prior_state,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'change-payment-method': {
        if (!payment_method_id) {
          return new Response(JSON.stringify({ error: 'payment_method_id required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Verify payment method belongs to user
        const { data: paymentMethod, error: pmError } = await supabase
          .from('payment_methods')
          .select('id, provider_token')
          .eq('id', payment_method_id)
          .eq('user_id', userId)
          .eq('status', 'active')
          .single();

        if (pmError || !paymentMethod) {
          return new Response(JSON.stringify({ error: 'Payment method not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            payment_method_id,
            payment_token: paymentMethod.provider_token,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Error changing payment method:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to change payment method' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          actor_user_id: userId,
          action: 'subscription.payment_method_changed',
          meta: { subscription_id, payment_method_id },
        });

        console.log(`Subscription ${subscription_id} payment method changed to ${payment_method_id}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error: unknown) {
    console.error('Error in subscription-actions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});