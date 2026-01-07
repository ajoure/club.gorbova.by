import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting subscription reconciliation...');
    const now = new Date();

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

        // Revoke Telegram access
        try {
          await supabase.functions.invoke('telegram-revoke-access', {
            body: { user_id: sub.user_id, reason: 'subscription_expired' },
          });
          console.log(`Revoked Telegram access for user ${sub.user_id}`);
        } catch (e) {
          console.error(`Failed to revoke Telegram access for user ${sub.user_id}:`, e);
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

          // Revoke Telegram access
          try {
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { user_id: sub.user_id, reason: 'trial_canceled' },
            });
          } catch (e) {
            console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
          }

          console.log(`Trial subscription ${sub.id} canceled after trial end`);
        }
        // If not canceled, the subscription-charge cron should handle the charge
      }
    }

    // 3. Close access for subscriptions with expired access_end_at
    const { data: expiredAccess, error: accessError } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, access_end_at, status')
      .lt('access_end_at', now.toISOString())
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

        // Revoke Telegram access
        try {
          await supabase.functions.invoke('telegram-revoke-access', {
            body: { user_id: sub.user_id, reason: 'access_expired' },
          });
        } catch (e) {
          console.error(`Failed to revoke Telegram for user ${sub.user_id}:`, e);
        }

        console.log(`Subscription ${sub.id} access expired`);
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
        // Check if user has valid subscription
        const { data: validSub } = await supabase
          .from('subscriptions_v2')
          .select('id')
          .eq('user_id', access.user_id)
          .in('status', ['active', 'trial'])
          .gte('access_end_at', now.toISOString())
          .limit(1)
          .single();

        if (!validSub) {
          // No valid subscription, check if active_until is also expired
          if (access.active_until && new Date(access.active_until) < now) {
            console.log(`User ${access.user_id} has no valid subscription, revoking Telegram access`);
            try {
              await supabase.functions.invoke('telegram-revoke-access', {
                body: { user_id: access.user_id, reason: 'no_valid_subscription' },
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