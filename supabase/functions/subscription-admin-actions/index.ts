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
    const { action, subscription_id, order_id, days, new_end_date, refund_amount, refund_reason, access_action, reduce_days } = body;

    console.log(`Admin ${adminUserId} performing ${action}`);

    // Handle refund separately since it uses order_id not subscription_id
    if (action === 'refund') {
      if (!order_id) {
        return new Response(JSON.stringify({ success: false, error: 'order_id required for refund' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!refund_reason || !refund_reason.trim()) {
        return new Response(JSON.stringify({ success: false, error: 'refund_reason required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get order with related payment
      const { data: order, error: orderError } = await supabase
        .from('orders_v2')
        .select('*, payments_v2(*)')
        .eq('id', order_id)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ success: false, error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (order.status !== 'paid') {
        return new Response(JSON.stringify({ success: false, error: 'Only paid orders can be refunded' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const actualRefundAmount = refund_amount || order.final_price;
      const payments = order.payments_v2 as any[];
      const successfulPayment = payments?.find((p: any) => p.status === 'succeeded' && p.provider_payment_id);
      
      let bepaidRefundResult: any = null;
      let bepaidRefundError: string | null = null;

      // Process refund through bePaid if we have a payment UID
      if (successfulPayment?.provider_payment_id) {
        const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
        
        // Get shop ID from settings
        const { data: settings } = await supabase
          .from('payment_settings')
          .select('key, value')
          .eq('key', 'bepaid_shop_id')
          .single();
        
        const shopId = settings?.value || '33524';

        if (bepaidSecretKey) {
          try {
            const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);
            const refundPayload = {
              request: {
                parent_uid: successfulPayment.provider_payment_id,
                amount: Math.round(actualRefundAmount * 100), // Convert to minimal units
                reason: refund_reason.trim().slice(0, 255),
              },
            };

            console.log(`Sending refund to bePaid: parent_uid=${successfulPayment.provider_payment_id}, amount=${refundPayload.request.amount}`);

            const bepaidResponse = await fetch('https://gateway.bepaid.by/transactions/refunds', {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${bepaidAuth}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify(refundPayload),
            });

            bepaidRefundResult = await bepaidResponse.json();
            console.log('bePaid refund response:', JSON.stringify(bepaidRefundResult));

            if (bepaidRefundResult.transaction?.status === 'successful') {
              console.log(`bePaid refund successful: uid=${bepaidRefundResult.transaction.uid}`);
            } else if (bepaidRefundResult.transaction?.status === 'failed') {
              bepaidRefundError = bepaidRefundResult.transaction.message || 'Refund failed';
              console.error('bePaid refund failed:', bepaidRefundError);
            } else if (bepaidRefundResult.errors) {
              bepaidRefundError = bepaidRefundResult.message || JSON.stringify(bepaidRefundResult.errors);
              console.error('bePaid refund error:', bepaidRefundError);
            }
          } catch (err) {
            bepaidRefundError = err instanceof Error ? err.message : String(err);
            console.error('bePaid API error:', bepaidRefundError);
          }
        } else {
          console.log('BEPAID_SECRET_KEY not configured, skipping payment gateway refund');
        }
      } else {
        console.log('No successful payment found with provider_payment_id, skipping bePaid refund');
      }

      // Update order status
      await supabase
        .from('orders_v2')
        .update({
          status: 'refunded',
          meta: {
            ...(order.meta as object || {}),
            refund_amount: actualRefundAmount,
            refund_reason: refund_reason,
            refunded_at: new Date().toISOString(),
            refunded_by: adminUserId,
            bepaid_refund: bepaidRefundResult?.transaction || null,
            bepaid_refund_error: bepaidRefundError,
            access_action: access_action || 'revoke',
            reduce_days: reduce_days || null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id);

      // Handle access action
      const effectiveAccessAction = access_action || 'revoke';
      
      // Find related subscription
      const { data: relatedSubscription } = await supabase
        .from('subscriptions_v2')
        .select('*, products_v2(telegram_club_id)')
        .eq('order_id', order_id)
        .maybeSingle();

      if (relatedSubscription) {
        const product = relatedSubscription.products_v2 as any;

        if (effectiveAccessAction === 'revoke') {
          // Revoke access immediately
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'canceled',
              access_end_at: new Date().toISOString(),
              cancel_at: new Date().toISOString(),
              canceled_at: new Date().toISOString(),
              cancel_reason: `Возврат: ${refund_reason}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', relatedSubscription.id);

          // Revoke Telegram access
          if (product?.telegram_club_id) {
            await supabase.functions.invoke('telegram-revoke-access', {
              body: { user_id: order.user_id },
            });
          }

          console.log(`Access revoked for subscription ${relatedSubscription.id}`);
        } else if (effectiveAccessAction === 'reduce' && reduce_days > 0) {
          // Reduce access period
          const currentEnd = relatedSubscription.access_end_at 
            ? new Date(relatedSubscription.access_end_at) 
            : new Date();
          const newEndDate = new Date(currentEnd.getTime() - reduce_days * 24 * 60 * 60 * 1000);
          
          // Don't let access end in the past
          const finalEndDate = newEndDate < new Date() ? new Date() : newEndDate;

          await supabase
            .from('subscriptions_v2')
            .update({
              access_end_at: finalEndDate.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', relatedSubscription.id);

          console.log(`Access reduced by ${reduce_days} days for subscription ${relatedSubscription.id}`);
        } else if (effectiveAccessAction === 'keep_subscription') {
          // Keep subscription active with scheduled charges - do nothing
          console.log(`Subscription ${relatedSubscription.id} kept active, scheduled charges continue`);
        }
        // 'keep' action = do nothing with access
      }

      // Log the refund action
      await supabase.from('audit_logs').insert({
        actor_user_id: adminUserId,
        target_user_id: order.user_id,
        action: 'admin.subscription.refund',
        meta: {
          order_id,
          order_number: order.order_number,
          refund_amount: actualRefundAmount,
          refund_reason: refund_reason,
          currency: order.currency,
          original_amount: order.final_price,
          access_action: effectiveAccessAction,
          reduce_days: reduce_days || null,
          bepaid_success: bepaidRefundResult?.transaction?.status === 'successful',
          bepaid_refund_uid: bepaidRefundResult?.transaction?.uid || null,
          bepaid_error: bepaidRefundError,
        },
      });

      console.log(`Refund processed for order ${order_id}: ${actualRefundAmount} ${order.currency}`);

      return new Response(JSON.stringify({ 
        success: true, 
        refund_amount: actualRefundAmount,
        order_number: order.order_number,
        bepaid_success: bepaidRefundResult?.transaction?.status === 'successful',
        bepaid_error: bepaidRefundError,
        access_action: effectiveAccessAction,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For other actions, subscription_id is required
    if (!subscription_id) {
      return new Response(JSON.stringify({ success: false, error: 'subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

        // Revoke Telegram access with club_id
        const productForRevoke = subscription.products_v2 as any;
        if (productForRevoke?.telegram_club_id) {
          const revokeResult = await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: subscription.user_id,
              club_id: productForRevoke.telegram_club_id,
              reason: 'subscription_revoked',
              admin_id: adminUserId,
            },
          });
          console.log('Telegram revoke result:', revokeResult.data);
        }
        break;
      }

      case 'delete': {
        // First revoke any access with proper club_id
        const productForDelete = subscription.products_v2 as any;
        if (productForDelete?.telegram_club_id) {
          const revokeResult = await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: subscription.user_id,
              club_id: productForDelete.telegram_club_id,
              reason: 'subscription_deleted',
              admin_id: adminUserId,
            },
          });
          console.log('Telegram revoke result:', revokeResult.data);
        }

        // Delete the subscription
        await supabase
          .from('subscriptions_v2')
          .delete()
          .eq('id', subscription_id);

        result.deleted = true;
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
