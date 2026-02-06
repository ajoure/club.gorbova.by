import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Helper function to check if user has any valid access (subscription, entitlement, or manual)
    async function hasValidAccess(userId: string): Promise<{ valid: boolean; source?: string; endAt?: string }> {
      const nowStr = now.toISOString();
      
      // 1. Check active subscription
      const { data: activeSub } = await supabase
        .from('subscriptions_v2')
        .select('id, access_end_at')
        .eq('user_id', userId)
        .in('status', ['active', 'trial', 'past_due'])
        .gt('access_end_at', nowStr)
        .limit(1)
        .maybeSingle();
      
      if (activeSub) {
        return { valid: true, source: 'subscription', endAt: activeSub.access_end_at };
      }
      
      // 2. Check active entitlement
      const { data: activeEntitlement } = await supabase
        .from('entitlements')
        .select('id, expires_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowStr}`)
        .limit(1)
        .maybeSingle();
      
      if (activeEntitlement) {
        return { valid: true, source: 'entitlement', endAt: activeEntitlement.expires_at };
      }
      
      // 3. Check manual access
      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('id, valid_until')
        .eq('user_id', userId)
        .eq('is_active', true)
        .or(`valid_until.is.null,valid_until.gt.${nowStr}`)
        .limit(1)
        .maybeSingle();
      
      if (manualAccess) {
        return { valid: true, source: 'manual_access', endAt: manualAccess.valid_until };
      }
      
      return { valid: false };
    }

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

        // PATCH 11B: Check if user has other valid access before revoking
        const access = await hasValidAccess(sub.user_id);
        if (access.valid) {
          console.log(`Skip revoke for ${sub.user_id}: has ${access.source} until ${access.endAt}`);
        } else {
          // Revoke Telegram access with club_id
          try {
            const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { 
                user_id: sub.user_id, 
                club_id: clubId,
                reason: 'subscription_expired' 
              },
            });
            console.log(`Revoked Telegram access for user ${sub.user_id}, club ${clubId}`);
          } catch (e) {
            console.error(`Failed to revoke Telegram access for user ${sub.user_id}:`, e);
          }
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

          // PATCH 11B: Check if user has other valid access before revoking
          const access = await hasValidAccess(sub.user_id);
          if (access.valid) {
            console.log(`Skip revoke for ${sub.user_id}: has ${access.source} until ${access.endAt}`);
          } else {
            // Revoke Telegram access with club_id
            try {
              const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { 
                  user_id: sub.user_id, 
                  club_id: clubId,
                  reason: 'trial_canceled' 
                },
              });
            } catch (e) {
              console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
            }
          }

          console.log(`Trial subscription ${sub.id} canceled after trial end`);
        }
        // If not canceled, the subscription-charge cron should handle the charge
      }
    }

    // 3. Close access for subscriptions with expired access_end_at
    // PATCH: Compare against start of TODAY in Minsk timezone (21:00 UTC yesterday = 00:00 Minsk today)
    // This ensures access lasts until the end of the expiration day
    const minskMidnightToday = new Date();
    minskMidnightToday.setUTCHours(21, 0, 0, 0); // 21:00 UTC = 00:00 Minsk
    if (minskMidnightToday > now) {
      // If 21:00 UTC hasn't happened yet today, use yesterday's 21:00 UTC
      minskMidnightToday.setDate(minskMidnightToday.getDate() - 1);
    }
    
    const { data: expiredAccess, error: accessError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, product_id, access_end_at, status, grace_period_status')
      .lt('access_end_at', minskMidnightToday.toISOString())
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

        // PATCH 11B: Check if user has other valid access before revoking
        const accessCheck = await hasValidAccess(sub.user_id);
        if (accessCheck.valid) {
          console.log(`Skip revoke for ${sub.user_id}: has ${accessCheck.source} until ${accessCheck.endAt}`);
        } else {
          // Revoke Telegram access with club_id
          // PATCH: Pass preserve_pricing flag if subscription is in grace
          const preservePricing = sub.grace_period_status === 'in_grace';
          
          try {
            const clubId = await getClubIdForSubscription(sub.user_id, sub.product_id);
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { 
                user_id: sub.user_id, 
                club_id: clubId,
                reason: 'access_expired',
                preserve_pricing: preservePricing, // PATCH: Don't mark was_club_member if grace active
              },
            });
          } catch (e) {
            console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
          }
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
        // PATCH 11B: Use comprehensive access check instead of just subscriptions
        const accessCheck = await hasValidAccess(access.user_id);

        if (!accessCheck.valid) {
          // No valid access, check if active_until is also expired
          if (access.active_until && new Date(access.active_until) < now) {
            console.log(`User ${access.user_id} has no valid access, revoking Telegram access`);
            try {
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { 
                  user_id: access.user_id, 
                  club_id: access.club_id,
                  reason: 'no_valid_access' 
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
