import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Send Telegram notification helper
async function sendTelegramNotification(
  supabase: any,
  userId: string,
  messageType: string,
  customMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('telegram-send-notification', {
      body: {
        user_id: userId,
        message_type: messageType,
        custom_message: customMessage,
      },
    });
    
    if (error) {
      console.log('Telegram notification error:', error.message);
      return { success: false, error: error.message };
    }
    
    return { success: data?.success ?? false, error: data?.error };
  } catch (err) {
    console.log('Telegram notification exception:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Cancel order in GetCourse
async function cancelGetCourseOrder(
  email: string,
  offerId: number | string,
  orderNumber: string,
  reason: string,
  amount: number = 0
): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping cancel');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log('No offerId for GetCourse cancel, skipping');
    return { success: false, error: 'No offer ID' };
  }
  
  try {
    console.log(`Canceling GetCourse order: email=${email}, offerId=${offerId}, amount=${amount}`);
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_cost: amount, // Required field for GetCourse
        deal_status: 'cancelled', // Set status to cancelled
        deal_is_paid: 0,
        deal_comment: `Отменено администратором. ${reason}. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse cancel params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse cancel response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    if (data.result?.success === true) {
      console.log('Order successfully cancelled in GetCourse');
      return { success: true };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse cancel error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse cancel API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// Update order in GetCourse (for extend/modify)
async function updateGetCourseOrder(
  email: string,
  offerId: number | string,
  orderNumber: string,
  newEndDate: string,
  amount: number = 0
): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping update');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log('No offerId for GetCourse update, skipping');
    return { success: false, error: 'No offer ID' };
  }
  
  try {
    console.log(`Updating GetCourse order: email=${email}, offerId=${offerId}, newEndDate=${newEndDate}`);
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        offer_code: offerId.toString(),
        deal_cost: amount,
        deal_status: 'in_work', // Active status
        deal_is_paid: 1,
        deal_comment: `Доступ продлён до ${newEndDate}. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse update params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse update response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    if (data.result?.success === true) {
      console.log('Order successfully updated in GetCourse');
      return { success: true };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse update error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse update API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

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

    // Get subscription with related product, tariff and order data
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*, products_v2(telegram_club_id, name), tariffs(getcourse_offer_id, getcourse_offer_code, name), orders_v2(order_number, customer_email, final_price)')
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

        // Send Telegram notification about cancellation (access_ending)
        const endDate = new Date(cancelAt).toLocaleDateString('ru-RU');
        const product = subscription.products_v2 as any;
        const clubName = product?.name || 'клубе';
        await sendTelegramNotification(
          supabase,
          subscription.user_id,
          'custom',
          `⏰ Подписка отменена\n\nАвтопродление отключено. Твой доступ в ${clubName} сохраняется до ${endDate}.\n\nПосле этой даты доступ будет закрыт автоматически.`
        );

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
        const newEndDateStr = newEndDate.toLocaleDateString('ru-RU');
        
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

        // Update in GetCourse
        const tariffForExtend = subscription.tariffs as any;
        const gcOfferIdExtend = tariffForExtend?.getcourse_offer_id || tariffForExtend?.getcourse_offer_code;
        const orderForExtend = subscription.orders_v2 as any;
        if (gcOfferIdExtend && orderForExtend?.customer_email) {
          const gcResult = await updateGetCourseOrder(
            orderForExtend.customer_email,
            gcOfferIdExtend,
            orderForExtend.order_number || subscription_id,
            newEndDateStr,
            orderForExtend.final_price || 0
          );
          console.log('GetCourse extend/update result:', gcResult);
          result.getcourse_update = gcResult;
        }

        // Send Telegram notification about extension
        const clubName = product?.name || 'клубе';
        await sendTelegramNotification(
          supabase,
          subscription.user_id,
          'custom',
          `✅ Доступ продлён!\n\nТвоя подписка в ${clubName} продлена на ${daysToAdd} дней.\nНовая дата окончания: ${newEndDateStr}\n\nСпасибо, что ты с нами 💙`
        );

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

        // Cancel in GetCourse with amount
        const tariffForRevoke = subscription.tariffs as any;
        const gcOfferIdRevoke = tariffForRevoke?.getcourse_offer_id || tariffForRevoke?.getcourse_offer_code;
        const orderForRevoke = subscription.orders_v2 as any;
        if (gcOfferIdRevoke && orderForRevoke?.customer_email) {
          const gcResult = await cancelGetCourseOrder(
            orderForRevoke.customer_email,
            gcOfferIdRevoke,
            orderForRevoke.order_number || subscription_id,
            'Доступ отозван администратором',
            orderForRevoke.final_price || 0
          );
          console.log('GetCourse cancel result:', gcResult);
          result.getcourse_cancel = gcResult;
        }

        // Send Telegram notification about revocation
        await sendTelegramNotification(supabase, subscription.user_id, 'access_revoked');

        break;
      }

      case 'delete': {
        // Send Telegram notification before deletion
        await sendTelegramNotification(supabase, subscription.user_id, 'access_revoked');

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

        // Cancel in GetCourse before deletion with amount
        const tariffForDelete = subscription.tariffs as any;
        const gcOfferIdDelete = tariffForDelete?.getcourse_offer_id || tariffForDelete?.getcourse_offer_code;
        const orderForDelete = subscription.orders_v2 as any;
        if (gcOfferIdDelete && orderForDelete?.customer_email) {
          const gcResult = await cancelGetCourseOrder(
            orderForDelete.customer_email,
            gcOfferIdDelete,
            orderForDelete.order_number || subscription_id,
            'Подписка удалена',
            orderForDelete.final_price || 0
          );
          console.log('GetCourse cancel result:', gcResult);
          result.getcourse_cancel = gcResult;
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
