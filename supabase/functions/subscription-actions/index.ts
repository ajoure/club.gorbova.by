import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, subscription_id, payment_method_id } = await req.json();
    console.log(`Subscription action: ${action} for subscription ${subscription_id} by user ${user.id}`);

    // Verify subscription belongs to user
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*')
      .eq('id', subscription_id)
      .eq('user_id', user.id)
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

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: cancelAt,
            canceled_at: new Date().toISOString(),
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
          actor_user_id: user.id,
          action: 'subscription.canceled',
          meta: { subscription_id, cancel_at: cancelAt },
        });

        console.log(`Subscription ${subscription_id} canceled, will end at ${cancelAt}`);
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

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: null,
            canceled_at: null,
            updated_at: new Date().toISOString(),
          })
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
          actor_user_id: user.id,
          action: 'subscription.resumed',
          meta: { subscription_id },
        });

        console.log(`Subscription ${subscription_id} resumed`);
        return new Response(JSON.stringify({ success: true }), {
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
          .eq('user_id', user.id)
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
          actor_user_id: user.id,
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