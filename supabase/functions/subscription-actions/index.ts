import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    
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

      case 'resume': {
        if (!subscription.cancel_at) {
          return new Response(JSON.stringify({ error: 'Subscription is not scheduled for cancellation' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if cancel_at is still in the future
        if (new Date(subscription.cancel_at) < new Date()) {
          return new Response(JSON.stringify({ error: 'Subscription has already expired' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Try to find user's active payment method to enable auto-renewal
        const { data: paymentMethod } = await supabase
          .from('payment_methods')
          .select('id, provider_token')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Prepare updated meta
        const existingMeta = subscription.meta as Record<string, unknown> || {};
        const newMeta = {
          ...existingMeta,
          cancel_source: null,
          resumed_at: new Date().toISOString(),
          resumed_by_user: true,
        };

        const updateData: Record<string, unknown> = {
          cancel_at: null,
          canceled_at: null,
          auto_renew: true, // IMPORTANT: re-enable auto-renew when user resumes
          // PATCH 13+: Clear disabled tracking when re-enabled
          auto_renew_disabled_by: null,
          auto_renew_disabled_at: null,
          auto_renew_disabled_by_user_id: null,
          meta: newMeta,
          updated_at: new Date().toISOString(),
        };

        // Link payment method if available
        if (paymentMethod) {
          updateData.payment_method_id = paymentMethod.id;
          updateData.payment_token = paymentMethod.provider_token;
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

        // Log the action
        await supabase.from('audit_logs').insert({
          actor_user_id: userId,
          action: 'subscription.resumed',
          meta: { 
            subscription_id, 
            auto_renew: true,
            payment_method_linked: !!paymentMethod,
          },
        });

        console.log(`Subscription ${subscription_id} resumed by user, auto_renew enabled`);
        return new Response(JSON.stringify({ 
          success: true, 
          auto_renew: true,
          payment_method_linked: !!paymentMethod,
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