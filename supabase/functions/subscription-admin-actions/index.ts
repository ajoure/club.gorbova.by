import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate JWT and check admin role
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JWT' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminUserId = claimsData.user.id;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check if user is admin
    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: adminUserId,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, subscription_id, days, new_end_date } = body;

    console.log(`Admin ${adminUserId} performing ${action} on subscription ${subscription_id}`);

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*, products_v2(telegram_club_id)')
      .eq('id', subscription_id)
      .single();

    if (subError || !subscription) {
      return new Response(JSON.stringify({ success: false, error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result: Record<string, any> = { success: true };

    switch (action) {
      case 'cancel': {
        const cancelAt = subscription.access_end_at || new Date().toISOString();
        
        await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: cancelAt,
            canceled_at: new Date().toISOString(),
            next_charge_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        result.cancel_at = cancelAt;
        break;
      }

      case 'resume': {
        await supabase
          .from('subscriptions_v2')
          .update({
            cancel_at: null,
            canceled_at: null,
            status: subscription.is_trial ? 'trial' : 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);
        break;
      }

      case 'pause': {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'paused',
            next_charge_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);
        break;
      }

      case 'extend': {
        const daysToAdd = days || 30;
        const currentEnd = subscription.access_end_at 
          ? new Date(subscription.access_end_at) 
          : new Date();
        const newEndDate = new Date(currentEnd.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        
        await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: newEndDate.toISOString(),
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Extend Telegram access if linked
        const product = subscription.products_v2 as any;
        if (product?.telegram_club_id) {
          await supabase.functions.invoke('telegram-grant-access', {
            body: {
              user_id: subscription.user_id,
              duration_days: daysToAdd,
            },
          });
        }

        result.new_end_date = newEndDate.toISOString();
        break;
      }

      case 'set_end_date': {
        if (!new_end_date) {
          return new Response(JSON.stringify({ success: false, error: 'new_end_date required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: new_end_date,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        result.new_end_date = new_end_date;
        break;
      }

      case 'grant_access': {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'active',
            cancel_at: null,
            canceled_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Grant Telegram access
        const product = subscription.products_v2 as any;
        if (product?.telegram_club_id && subscription.access_end_at) {
          const daysRemaining = Math.ceil(
            (new Date(subscription.access_end_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          );
          if (daysRemaining > 0) {
            await supabase.functions.invoke('telegram-grant-access', {
              body: {
                user_id: subscription.user_id,
                duration_days: daysRemaining,
              },
            });
          }
        }
        break;
      }

      case 'revoke_access': {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'canceled',
            access_end_at: new Date().toISOString(),
            cancel_at: new Date().toISOString(),
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscription_id);

        // Revoke Telegram access
        const product = subscription.products_v2 as any;
        if (product?.telegram_club_id) {
          await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: subscription.user_id,
            },
          });
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ success: false, error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Log the admin action
    await supabase.from('audit_logs').insert({
      actor_user_id: adminUserId,
      target_user_id: subscription.user_id,
      action: `admin.subscription.${action}`,
      meta: {
        subscription_id,
        action,
        days,
        new_end_date,
        ...result,
      },
    });

    console.log(`Admin action ${action} completed for subscription ${subscription_id}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Admin subscription action error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
