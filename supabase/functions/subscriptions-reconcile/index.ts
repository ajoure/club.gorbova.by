import { createClient } from "npm:@supabase/supabase-js@2";
// COMMERCIAL-ONLY (2026-05-22): hasValidAccess import удалён — не используется. Revoke решения идут через access-revoker (hasCommercialAccess).
import { executeRevoke } from '../_shared/access-revoker.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting subscription reconciliation...');
    const now = new Date();
    const jobRunId = crypto.randomUUID();

    // Helper function to get club_id for a subscription
    async function getClubIdForSubscription(userId: string, productId: string): Promise<string | null> {
      // First try to get from product
      const { data: product } = await supabase
        .from('products_v2')
        .select('telegram_club_id')
        .eq('id', productId)
        .single();
      
      if (product?.telegram_club_id) return product.telegram_club_id;
      
      // Fallback: get from active telegram_access
      const { data: access } = await supabase
        .from('telegram_access')
        .select('club_id')
        .eq('user_id', userId)
        .in('state_chat', ['joined', 'invited'])
        .limit(1)
        .single();
      
      return access?.club_id || null;
    }

    // 1. Find subscriptions that should be canceled (cancel_at passed)
    const { data: expiredCancellations, error: cancelError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, cancel_at, status')
      .lt('cancel_at', now.toISOString())
      .neq('status', 'canceled');

    if (cancelError) {
      console.error('Error fetching expired cancellations:', cancelError);
    } else if (expiredCancellations && expiredCancellations.length > 0) {
      console.log(`Found ${expiredCancellations.length} subscriptions to cancel`);
      
      for (const sub of expiredCancellations) {
        // Update subscription status
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'canceled',
            access_end_at: sub.cancel_at,
            updated_at: now.toISOString(),
          })
          .eq('id', sub.id);

        // Phase 1: Use AccessRevoker with ledger write
        const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
        const revokeResult = await executeRevoke(supabase, {
          userId: sub.user_id,
          targetType: 'subscription_tier',
          targetKey: `${sub.user_id}:${sub.product_id}`,
          targetRef: sub.id,
          subscriptionId: sub.id,
          reasonCode: 'subscription_expired',
          reconcileBasis: 'cancel_at_passed',
          sourceEventType: 'cron',
          sourceEventKey: `cron-reconcile:${jobRunId}:${sub.id}`,
          sourceSubjectType: 'subscription',
          sourceSubjectRef: sub.id,
          clubId: clubId,
        });

        if (revokeResult.revoked) {
          // Sub-patch B: Pass parent lineage to downstream telegram-revoke-access
          try {
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { 
                user_id: sub.user_id, 
                club_id: clubId,
                reason: 'subscription_expired',
                parent_event_key: `cron-reconcile:${jobRunId}:${sub.id}`,
                parent_execution_key: revokeResult.executionKey || null,
              },
            });
            console.log(`Revoked Telegram access for user ${sub.user_id}, club ${clubId}`);
          } catch (e) {
            console.error(`Failed to revoke Telegram access for user ${sub.user_id}:`, e);
          }
        } else {
          console.log(`Skip revoke for ${sub.user_id}: ${revokeResult.skippedReason}`);
        }

        // Log the action
        await supabase.from('audit_logs').insert({
          actor_user_id: sub.user_id,
          action: 'subscription.expired',
          meta: { subscription_id: sub.id, canceled_at: now.toISOString() },
        });

        console.log(`Subscription ${sub.id} marked as canceled`);
      }
    }

    // 2. Find trial subscriptions that have ended
    const { data: expiredTrials, error: trialError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, trial_end_at, status, cancel_at')
      .eq('is_trial', true)
      .lt('trial_end_at', now.toISOString())
      .in('status', ['trial', 'active']);

    if (trialError) {
      console.error('Error fetching expired trials:', trialError);
    } else if (expiredTrials && expiredTrials.length > 0) {
      console.log(`Found ${expiredTrials.length} expired trials`);
      
      for (const sub of expiredTrials) {
        // If cancel_at is set (user canceled during trial), mark as canceled
        if (sub.cancel_at) {
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'canceled',
              access_end_at: sub.trial_end_at,
              updated_at: now.toISOString(),
            })
            .eq('id', sub.id);

          // Phase 1: Use AccessRevoker with ledger
          const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
          const revokeResult = await executeRevoke(supabase, {
            userId: sub.user_id,
            targetType: 'subscription_tier',
            targetKey: `${sub.user_id}:${sub.product_id}`,
            targetRef: sub.id,
            subscriptionId: sub.id,
            reasonCode: 'trial_expired',
            reconcileBasis: 'trial_end_at_passed_and_canceled',
            sourceEventType: 'cron',
            sourceEventKey: `cron-reconcile:${jobRunId}:trial:${sub.id}`,
            sourceSubjectType: 'subscription',
            sourceSubjectRef: sub.id,
            clubId: clubId,
          });

          if (revokeResult.revoked) {
            try {
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { 
                  user_id: sub.user_id, 
                  club_id: clubId, 
                  reason: 'trial_canceled',
                  parent_event_key: `cron-reconcile:${jobRunId}:trial:${sub.id}`,
                  parent_execution_key: revokeResult.executionKey || null,
                },
              });
            } catch (e) {
              console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
            }
          } else {
            console.log(`Skip revoke for ${sub.user_id}: ${revokeResult.skippedReason}`);
          }

          console.log(`Trial subscription ${sub.id} canceled after trial end`);
        }
        // If not canceled, the subscription-charge cron should handle the charge
      }
    }

    // 3. Close access for subscriptions with expired access_end_at
    // F10: Use APP_TZ (Europe/Minsk) for consistent day boundaries
    const { APP_TZ, todayDateKey: reconcileTodayDateKey, dayWindowUtc: reconcileDayWindowUtc } = await import('../_shared/timezone.ts');
    const reconcileTodayKey = reconcileTodayDateKey(APP_TZ);
    const { start: minskDayStart } = reconcileDayWindowUtc(APP_TZ, reconcileTodayKey);
    console.log(`[F10] Reconcile: APP_TZ=${APP_TZ}, todayKey=${reconcileTodayKey}, dayStart=${minskDayStart}`);
    
    const { data: expiredAccess, error: accessError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, access_end_at, status, grace_period_status')
      .lt('access_end_at', minskDayStart)
      .in('status', ['active', 'past_due']);

    if (accessError) {
      console.error('Error fetching expired access:', accessError);
    } else if (expiredAccess && expiredAccess.length > 0) {
      console.log(`Found ${expiredAccess.length} subscriptions with expired access`);
      
      for (const sub of expiredAccess) {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'expired',
            updated_at: now.toISOString(),
          })
          .eq('id', sub.id);

        // Phase 1: Use AccessRevoker with ledger
        const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
        const preservePricing = sub.grace_period_status === 'in_grace';
        
        const revokeResult = await executeRevoke(supabase, {
          userId: sub.user_id,
          targetType: 'subscription_tier',
          targetKey: `${sub.user_id}:${sub.product_id}`,
          targetRef: sub.id,
          subscriptionId: sub.id,
          reasonCode: 'subscription_expired',
          reconcileBasis: 'access_end_at_passed',
          sourceEventType: 'cron',
          sourceEventKey: `cron-reconcile:${jobRunId}:expired:${sub.id}`,
          sourceSubjectType: 'subscription',
          sourceSubjectRef: sub.id,
          clubId: clubId,
          metadata: { preserve_pricing: preservePricing, grace_period_status: sub.grace_period_status },
        });

        if (revokeResult.revoked) {
          try {
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { 
                user_id: sub.user_id, 
                club_id: clubId,
                reason: 'access_expired',
                preserve_pricing: preservePricing,
                parent_event_key: `cron-reconcile:${jobRunId}:expired:${sub.id}`,
                parent_execution_key: revokeResult.executionKey || null,
              },
            });
          } catch (e) {
            console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
          }
        } else {
          console.log(`Skip revoke for ${sub.user_id}: ${revokeResult.skippedReason}`);
        }

        // PATCH: DON'T mark was_club_member here!
        // This is now done by subscription-charge/subscription-grace-reminders after grace expires
        console.log(`Subscription ${sub.id} access expired (grace_status=${sub.grace_period_status || 'null'})`);
      }
    }

    // 4. Sync Telegram access - ensure users without valid subscriptions are removed
    const { data: telegramAccess, error: tgError } = await supabase
      .from('telegram_access')
      .select('id, user_id, club_id, state_chat, state_channel, active_until')
      .or('state_chat.eq.joined,state_channel.eq.joined');

    if (tgError) {
      console.error('Error fetching telegram access:', tgError);
    } else if (telegramAccess && telegramAccess.length > 0) {
      for (const access of telegramAccess) {
        // Phase 1: Use AccessRevoker with ledger
        const revokeResult = await executeRevoke(supabase, {
          userId: access.user_id,
          targetType: 'club',
          targetKey: `${access.user_id}:${access.club_id}`,
          targetRef: access.id,
          reasonCode: 'cron_cleanup',
          reconcileBasis: 'no_valid_access_for_telegram_member',
          sourceEventType: 'cron',
          sourceEventKey: `cron-reconcile:${jobRunId}:tg:${access.user_id}:${access.club_id}`,
          sourceSubjectType: 'cron_job',
          sourceSubjectRef: access.id,
          clubId: access.club_id,
        });

        if (revokeResult.revoked) {
          // No valid access, check if active_until is also expired
          if (access.active_until && new Date(access.active_until) < now) {
            console.log(`User ${access.user_id} has no valid access, revoking Telegram access`);
            try {
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { 
                  user_id: access.user_id, 
                  club_id: access.club_id, 
                  reason: 'no_valid_access',
                  parent_event_key: `cron-reconcile:${jobRunId}:tg:${access.user_id}:${access.club_id}`,
                  parent_execution_key: revokeResult.executionKey || null,
                },
              });
            } catch (e) {
              console.error(`Failed to revoke Telegram for user ${access.user_id}:`, e);
            }
          }
        }
      }
    }

    console.log('Subscription reconciliation completed');
    
    return new Response(JSON.stringify({ 
      success: true,
      processed: {
        canceled: expiredCancellations?.length || 0,
        trials_expired: expiredTrials?.length || 0,
        access_expired: expiredAccess?.length || 0,
        telegram_synced: telegramAccess?.length || 0,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error in subscriptions-reconcile:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
