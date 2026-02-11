import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
  amount: number = 0,
  gcDealId?: string | number // GetCourse deal_id to update existing deal
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
    console.log(`Canceling GetCourse order: email=${email}, offerId=${offerId}, amount=${amount}, gcDealId=${gcDealId}`);
    
    // Build deal object - use deal_number to update existing deal if we have gc_deal_id
    const dealParams: Record<string, any> = {
      offer_code: offerId.toString(),
      deal_cost: amount, // Required field for GetCourse
      deal_is_paid: 0, // Устанавливаем ложный статус оплаты вместо отмены статуса
      deal_comment: `Отменено администратором. ${reason}. Order: ${orderNumber}`,
    };
    
    // CRITICAL: Pass deal_number to update existing deal instead of creating new one
    if (gcDealId) {
      dealParams.deal_number = parseInt(String(gcDealId), 10);
      console.log(`Using deal_number=${dealParams.deal_number} to update existing GetCourse deal`);
    }
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: dealParams,
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
  amount: number = 0,
  gcDealId?: string | number // GetCourse deal_id to update existing deal
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
    console.log(`Updating GetCourse order: email=${email}, offerId=${offerId}, newEndDate=${newEndDate}, gcDealId=${gcDealId}`);
    
    // Build deal object - use deal_number to update existing deal if we have gc_deal_id
    const dealParams: Record<string, any> = {
      offer_code: offerId.toString(),
      deal_cost: amount,
      deal_status: 'in_work', // Active status
      deal_is_paid: 1,
      deal_comment: `Доступ продлён до ${newEndDate}. Order: ${orderNumber}`,
    };
    
    // CRITICAL: Pass deal_number to update existing deal instead of creating new one
    if (gcDealId) {
      dealParams.deal_number = parseInt(String(gcDealId), 10);
      console.log(`Using deal_number=${dealParams.deal_number} to update existing GetCourse deal`);
    }
    
    const params = {
      user: {
        email: email,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: dealParams,
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
        // PATCH-P0.9.1: Strict creds
        const credsResult = await getBepaidCredsStrict(supabase);
        
        if (isBepaidCredsError(credsResult)) {
          console.log('BEPAID_CREDS_MISSING, skipping refund: ' + credsResult.error);
        } else {
          const bepaidCreds = credsResult;
          try {
            const bepaidAuth = createBepaidAuthHeader(bepaidCreds);
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
                'Authorization': bepaidAuth,
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
        }
      } else {
        console.log('No successful payment found with provider_payment_id, skipping bePaid refund');
      }

      // Check if bePaid refund succeeded (or if there was no bePaid payment to refund)
      const hasBepaidPayment = !!successfulPayment?.provider_payment_id;
      const bepaidRefundSuccessful = bepaidRefundResult?.transaction?.status === 'successful';
      
      // If there was a bePaid payment and refund failed, return error - don't update order
      if (hasBepaidPayment && !bepaidRefundSuccessful) {
        console.error(`bePaid refund failed for order ${order_id}, NOT marking as refunded`);
        
        // Log the failed attempt
        await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: order.user_id,
          action: 'admin.subscription.refund_failed',
          meta: {
            order_id,
            order_number: order.order_number,
            refund_amount: actualRefundAmount,
            refund_reason: refund_reason,
            bepaid_error: bepaidRefundError,
            bepaid_response: bepaidRefundResult,
          },
        });

        return new Response(JSON.stringify({ 
          success: false, 
          error: bepaidRefundError || 'Ошибка возврата в bePaid. Статус заказа не изменён.',
          bepaid_error: bepaidRefundError,
          bepaid_response: bepaidRefundResult,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // bePaid refund successful OR no bePaid payment - proceed with order update
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

      // Create refund record in payments_v2 if bePaid refund was successful
      if (bepaidRefundSuccessful) {
        await supabase
          .from('payments_v2')
          .insert({
            order_id: order_id,
            profile_id: order.profile_id,
            user_id: order.user_id,
            amount: -actualRefundAmount, // Negative amount for refund
            currency: order.currency,
            status: 'succeeded',
            provider: 'bepaid',
            provider_payment_id: bepaidRefundResult.transaction.uid,
            paid_at: new Date().toISOString(),
            meta: {
              type: 'refund',
              parent_payment_id: successfulPayment.provider_payment_id,
              parent_payment_uid: successfulPayment.provider_payment_id,
              reason: refund_reason,
              bepaid_response: bepaidRefundResult.transaction,
            },
          });
        console.log(`Created refund record in payments_v2 with uid=${bepaidRefundResult.transaction.uid}`);
      }

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

      // Log the successful refund action
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
          bepaid_success: bepaidRefundSuccessful,
          bepaid_refund_uid: bepaidRefundResult?.transaction?.uid || null,
          bepaid_error: bepaidRefundError,
          had_bepaid_payment: hasBepaidPayment,
        },
      });

      console.log(`Refund processed for order ${order_id}: ${actualRefundAmount} ${order.currency}`);

      return new Response(JSON.stringify({ 
        success: true, 
        refund_amount: actualRefundAmount,
        order_number: order.order_number,
        bepaid_success: bepaidRefundSuccessful,
        bepaid_error: bepaidRefundError,
        access_action: effectiveAccessAction,
        refund_payment_uid: bepaidRefundResult?.transaction?.uid || null,
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

    // Get subscription with related product and tariff
    // Note: orders_v2 can have multiple orders per subscription, so we fetch it separately
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions_v2')
      .select('*, products_v2(telegram_club_id, name), tariffs(getcourse_offer_id, getcourse_offer_code, name)')
      .eq('id', subscription_id)
      .maybeSingle();

    if (subError || !subscription) {
      console.log('Subscription lookup error:', subError?.message || 'not found', 'subscription_id:', subscription_id);

      // Idempotency: deleting an already-deleted subscription should not break UI flows
      if (action === 'delete') {
        return new Response(
          JSON.stringify({ success: true, already_deleted: true, subscription_id }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(JSON.stringify({ success: false, error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch order data - use subscription.order_id (direct FK) or fallback to user_id + product_id
    let orderData = null;
    
    if (subscription.order_id) {
      // Primary: use the direct FK link
      const { data } = await supabase
        .from('orders_v2')
        .select('order_number, customer_email, final_price, meta, user_id')
        .eq('id', subscription.order_id)
        .maybeSingle();
      orderData = data;
    }
    
    // Fallback: if no order_id, search by user_id + product_id
    if (!orderData && subscription.user_id && subscription.product_id) {
      const { data: ordersData, count } = await supabase
        .from('orders_v2')
        .select('order_number, customer_email, final_price, meta, user_id', { count: 'exact' })
        .eq('user_id', subscription.user_id)
        .eq('product_id', subscription.product_id)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(1);
      
      orderData = ordersData?.[0] || null;
      
      if (count && count > 1) {
        console.warn(`[subscription-admin-actions] Multiple orders (${count}) found for subscription ${subscription_id}, using latest`);
      }
    }

    // Attach order data to subscription object for backward compatibility
    (subscription as any).orders_v2 = orderData;

    // Get email from profiles - search by both profile.id and user_id since user_id might be profile.id
    const { data: profileData } = await supabase
      .from('profiles')
      .select('email')
      .or(`id.eq.${subscription.user_id},user_id.eq.${subscription.user_id}`)
      .maybeSingle();

    // Get email from profiles or order (orderData already attached above)
    const customerEmail = orderData?.customer_email || profileData?.email;

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

        // Update in GetCourse with gc_deal_number for update
        const tariffForExtend = subscription.tariffs as any;
        const gcOfferIdExtend = tariffForExtend?.getcourse_offer_id || tariffForExtend?.getcourse_offer_code;
        const orderForExtend = subscription.orders_v2 as any;
        // Use gc_deal_number (our generated number) for updates, fallback to gc_order_id
        const gcDealNumberExtend = orderForExtend?.meta?.gc_deal_number || orderForExtend?.meta?.gc_order_id;
        if (gcOfferIdExtend && orderForExtend?.customer_email) {
          const gcResult = await updateGetCourseOrder(
            orderForExtend.customer_email,
            gcOfferIdExtend,
            orderForExtend.order_number || subscription_id,
            newEndDateStr,
            orderForExtend.final_price || 0,
            gcDealNumberExtend // Pass deal_number to update existing deal
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

        // Cancel in GetCourse with gc_deal_number for update
        const tariffForRevoke = subscription.tariffs as any;
        const orderForRevoke = subscription.orders_v2 as any;
        // Get offer_id from order meta first, then fallback to tariff
        const orderMeta = orderForRevoke?.meta || {};
        let gcOfferIdRevoke = tariffForRevoke?.getcourse_offer_id || tariffForRevoke?.getcourse_offer_code;
        
        // If offer_id in meta, get getcourse_offer_id from tariff_offers
        if (orderMeta.offer_id) {
          const { data: offerData } = await supabase
            .from('tariff_offers')
            .select('getcourse_offer_id')
            .eq('id', orderMeta.offer_id)
            .single();
          if (offerData?.getcourse_offer_id) {
            gcOfferIdRevoke = offerData.getcourse_offer_id;
          }
        }
        
        // Use gc_deal_number (our generated number) for updates, fallback to gc_order_id
        const gcDealNumberRevoke = orderMeta.gc_deal_number || orderMeta.gc_order_id;
        const emailForRevoke = orderForRevoke?.customer_email || customerEmail;
        
        if (gcOfferIdRevoke && emailForRevoke) {
          const gcResult = await cancelGetCourseOrder(
            emailForRevoke,
            gcOfferIdRevoke,
            orderForRevoke?.order_number || subscription_id,
            'Доступ отозван администратором',
            orderForRevoke?.final_price || 0,
            gcDealNumberRevoke // Pass deal_number to update existing deal
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

        // Cancel in GetCourse before deletion with amount and deal_number
        const tariffForDelete = subscription.tariffs as any;
        const gcOfferIdDelete = tariffForDelete?.getcourse_offer_id || tariffForDelete?.getcourse_offer_code;
        const orderForDelete = subscription.orders_v2 as any;
        // Use gc_deal_number (our generated number) for updates, fallback to gc_order_id
        const gcDealNumberDelete = orderForDelete?.meta?.gc_deal_number || orderForDelete?.meta?.gc_order_id;
        if (gcOfferIdDelete && orderForDelete?.customer_email) {
          const gcResult = await cancelGetCourseOrder(
            orderForDelete.customer_email,
            gcOfferIdDelete,
            orderForDelete.order_number || subscription_id,
            'Подписка удалена',
            orderForDelete.final_price || 0,
            gcDealNumberDelete // Pass deal_number to update existing deal
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

      case 'toggle_auto_renew': {
        const { auto_renew: newAutoRenew, reason } = body;

        if (typeof newAutoRenew !== 'boolean') {
          return new Response(JSON.stringify({ success: false, error: 'auto_renew must be boolean' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const existingMeta = subscription.meta as Record<string, unknown> || {};
        const updateData: Record<string, unknown> = {
          auto_renew: newAutoRenew,
          meta: {
            ...existingMeta,
            auto_renew_changed_by: adminUserId,
            auto_renew_changed_at: new Date().toISOString(),
            auto_renew_change_reason: reason || (newAutoRenew ? 'Включено администратором' : 'Отключено администратором'),
          },
          updated_at: new Date().toISOString(),
        };

        // If enabling auto-renew, try to link payment method
        if (newAutoRenew) {
          const { data: paymentMethod } = await supabase
            .from('payment_methods')
            .select('id, provider_token')
            .eq('user_id', subscription.user_id)
            .eq('status', 'active')
            .order('is_default', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (paymentMethod) {
            updateData.payment_method_id = paymentMethod.id;
            updateData.payment_token = paymentMethod.provider_token;
          }
          result.payment_method_linked = !!paymentMethod;
        } else {
          // If disabling, clear payment method link
          updateData.payment_method_id = null;
          updateData.payment_token = null;
          result.payment_method_linked = false;
        }

        const { error: updateError } = await supabase
          .from('subscriptions_v2')
          .update(updateData)
          .eq('id', subscription_id);

        if (updateError) {
          console.error('Error toggling auto-renew:', updateError);
          return new Response(JSON.stringify({ success: false, error: 'Failed to toggle auto-renew' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Log the specific action
        await supabase.from('audit_logs').insert({
          actor_user_id: adminUserId,
          target_user_id: subscription.user_id,
          action: newAutoRenew ? 'admin.subscription.auto_renew_enabled' : 'admin.subscription.auto_renew_disabled',
          meta: {
            subscription_id,
            order_id: subscription.order_id,
            reason: reason || null,
            has_payment_method: result.payment_method_linked,
          },
        });

        result.auto_renew = newAutoRenew;
        console.log(`Admin toggled auto-renew to ${newAutoRenew} for subscription ${subscription_id}`);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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
