import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate a consistent deal_number from orderNumber for GetCourse
function generateDealNumber(orderNumber: string): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    const char = orderNumber.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// GetCourse sync helper
interface GetCourseUserData {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

async function sendToGetCourse(
  userData: GetCourseUserData,
  orderId: string,
  orderNumber: string,
  amount: number,
  productName: string,
  tariffName: string,
  gcOfferId: number | null,
  dealNumber: number // Pass the deal_number we're using
): Promise<{ success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number }> {
  const gcApiKey = Deno.env.get('GETCOURSE_API_KEY');
  const gcEmailRaw = Deno.env.get('GETCOURSE_EMAIL') || 'gorbova';
  
  let gcAccount = gcEmailRaw;
  if (gcEmailRaw.includes('getcourse.ru')) {
    const match = gcEmailRaw.match(/(?:https?:\/\/)?([^.]+)\.getcourse\.ru/);
    gcAccount = match ? match[1] : 'gorbova';
  }
  
  if (!gcApiKey) {
    console.log('[Test Payment Direct] GetCourse API key not configured');
    return { success: false, error: 'API key not configured' };
  }

  try {
    const gcUrl = `https://${gcAccount}.getcourse.ru/pl/api/deals`;
    console.log('[Test Payment Direct] GC URL:', gcUrl);
    
    const dealData: Record<string, any> = {
      user: {
        email: userData.email,
        first_name: userData.first_name || '',
        phone: userData.phone || '',
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        deal_number: dealNumber, // Use the passed deal_number
        deal_cost: amount,
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Тест-оплата (direct). Заказ: ${orderNumber}. Тариф: ${tariffName}`,
      },
    };
    
    console.log(`[Test Payment Direct] Using deal_number: ${dealNumber}`);

    if (gcOfferId) {
      dealData.deal.offer_code = gcOfferId.toString();
    }

    console.log('[Test Payment Direct] Sending to GetCourse:', JSON.stringify(dealData));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', gcApiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(dealData)))));

    const response = await fetch(gcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const responseText = await response.text();
    console.log('[Test Payment Direct] GetCourse response:', responseText);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error('[Test Payment Direct] Failed to parse GC response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }

    if (result.result?.success === true) {
      return { 
        success: true, 
        gcOrderId: result.result?.deal_id?.toString(),
        gcDealNumber: dealNumber, // Return the deal_number we used
      };
    } else {
      const errorMsg = result.result?.error_message || result.error_message || JSON.stringify(result);
      return { 
        success: false, 
        error: errorMsg 
      };
    }
  } catch (error) {
    console.error('[Test Payment Direct] GetCourse sync error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { orderId, secretKey } = await req.json();
    
    // Simple secret key check for direct testing
    if (secretKey !== 'test-direct-2024') {
      return new Response(
        JSON.stringify({ error: 'Invalid secret key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Test Payment Direct] Simulating payment for order ${orderId}`);

    const now = new Date();

    const results: Record<string, any> = {
      order_updated: false,
      payment_created: false,
      subscription_created: false,
      entitlement_created: false,
      telegram_access_granted: 0,
    };

    // Fetch order with tariff and product info
    const { data: orderV2 } = await supabase
      .from('orders_v2')
      .select('*, tariffs(id, name, code, access_days, getcourse_offer_id, product_id, products_v2(id, name, code, telegram_club_id))')
      .eq('id', orderId)
      .maybeSingle();

    if (!orderV2) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tariff = (orderV2 as any).tariffs;
    const product = tariff?.products_v2;
    
    if (!orderV2.user_id) {
      return new Response(
        JSON.stringify({ error: 'Order is missing user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use product from tariff if order doesn't have it directly
    const productId = orderV2.product_id || tariff?.product_id;
    const productCode = product?.code;

    const orderMeta = (orderV2.meta || {}) as Record<string, any>;

    // Get trial_days from offer if available
    let offerTrialDays: number | null = null;
    let offerAutoChargeAmount: number | null = null;
    let offerGetcourseId: string | null = null;
    
    if (orderMeta.offer_id) {
      const { data: offerData } = await supabase
        .from('tariff_offers')
        .select('trial_days, auto_charge_amount, getcourse_offer_id')
        .eq('id', orderMeta.offer_id)
        .maybeSingle();
      
      if (offerData) {
        offerTrialDays = offerData.trial_days;
        offerAutoChargeAmount = offerData.auto_charge_amount;
        offerGetcourseId = offerData.getcourse_offer_id;
      }
    }

    console.log(`[Test Payment Direct] Using offer from meta: offerGetcourseId=${offerGetcourseId}, offer_id=${orderMeta.offer_id}`);

    // Calculate access days
    const accessDays = orderV2.is_trial
      ? (offerTrialDays || orderMeta.trial_days || tariff?.trial_days || 5)
      : (tariff?.access_days || 30);

    console.log(`[Test Payment Direct] Trial=${orderV2.is_trial}, accessDays=${accessDays}`);

    const accessStartAt = now.toISOString();
    const accessEndAt = orderV2.is_trial && orderV2.trial_end_at
      ? new Date(orderV2.trial_end_at)
      : new Date(now.getTime() + accessDays * 24 * 60 * 60 * 1000);

    // Mark order paid
    const testUid = `TEST-DIRECT-${Date.now()}`;
    const { error: orderUpdateError } = await supabase
      .from('orders_v2')
      .update({
        status: 'paid',
        paid_amount: orderV2.final_price,
        meta: {
          ...(orderV2.meta || {}),
          test_payment: true,
          test_payment_direct: true,
          test_payment_at: now.toISOString(),
          bepaid_uid: testUid,
        },
        updated_at: now.toISOString(),
      })
      .eq('id', orderV2.id);

    if (!orderUpdateError) results.order_updated = true;

    // Create payment record
    const { data: paymentV2, error: paymentError } = await supabase
      .from('payments_v2')
      .insert({
        order_id: orderV2.id,
        user_id: orderV2.user_id,
        amount: orderV2.final_price,
        currency: orderV2.currency,
        status: 'succeeded',
        provider: 'admin_test_direct',
        paid_at: now.toISOString(),
        is_recurring: false,
        meta: {
          test_payment_direct: true,
        },
      })
      .select('id')
      .single();

    if (!paymentError && paymentV2?.id) {
      results.payment_created = true;
    }

    // Create subscription
    const nextChargeAt = orderV2.is_trial ? accessEndAt.toISOString() : null;
    
    const { error: subError } = await supabase
      .from('subscriptions_v2')
      .insert({
        user_id: orderV2.user_id,
        product_id: productId,
        tariff_id: orderV2.tariff_id,
        order_id: orderV2.id,
        status: orderV2.is_trial ? 'trial' : 'active',
        is_trial: !!orderV2.is_trial,
        auto_renew: !!orderV2.is_trial,
        access_start_at: accessStartAt,
        access_end_at: accessEndAt.toISOString(),
        trial_end_at: orderV2.is_trial ? accessEndAt.toISOString() : null,
        next_charge_at: nextChargeAt,
        updated_at: now.toISOString(),
      });

    if (!subError) results.subscription_created = true;
    else results.subscription_error = subError.message;

    // Entitlement
    if (productCode) {
      const { error: entError } = await supabase
        .from('entitlements')
        .upsert(
          {
            user_id: orderV2.user_id,
            product_code: productCode,
            status: 'active',
            expires_at: accessEndAt.toISOString(),
            meta: { source: 'admin_test_direct', order_id: orderV2.id },
          },
          { onConflict: 'user_id,product_code' }
        );
      results.entitlement_created = !entError;
      if (entError) results.entitlement_error = entError.message;
    }

    // Telegram access
    if (product?.telegram_club_id) {
      const grantRes = await supabase.functions.invoke('telegram-grant-access', {
        body: {
          user_id: orderV2.user_id,
          club_id: product.telegram_club_id,
          source: 'card_payment',
          source_id: orderV2.id,
        },
      });
      if (!grantRes.error) results.telegram_access_granted = 1;
      else results.telegram_grant_error = grantRes.error.message;
    }

    // Get user profile early for notifications and GetCourse (profiles.user_id = auth user id)
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('email, full_name, first_name, last_name, phone')
      .eq('user_id', orderV2.user_id)
      .maybeSingle();

    // Notify admins about new paid deal
    const adminMessage = `🎉 <b>Новая оплата!</b>

👤 ${userProfile?.full_name || userProfile?.email || orderV2.customer_email || 'Клиент'}
📧 ${userProfile?.email || orderV2.customer_email}
📦 ${product?.name || 'Продукт'} — ${tariff?.name || 'Тариф'}
💰 ${orderV2.final_price} ${orderV2.currency}
${orderV2.is_trial ? '🎁 Триал' : '✅ Полная оплата'}
🧾 ${orderV2.order_number}`;

    try {
      const notifyRes = await supabase.functions.invoke('telegram-notify-admins', {
        body: { message: adminMessage, parse_mode: 'HTML' },
      });
      results.admin_notification_sent = !notifyRes.error;
      if (notifyRes.error) results.admin_notification_error = notifyRes.error.message;
      if (notifyRes.data) results.admin_notification_result = notifyRes.data;
    } catch (notifyErr) {
      results.admin_notification_error = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
    }

    // GetCourse sync
    const gcOfferId = offerGetcourseId || orderMeta.getcourse_offer_id || tariff?.getcourse_offer_id || null;

    if (userProfile?.email) {
      // Generate a unique deal_number for GetCourse based on order_number
      const gcDealNumber = generateDealNumber(orderV2.order_number);
      
      const gcResult = await sendToGetCourse(
        {
          email: userProfile.email,
          first_name: userProfile.first_name || userProfile.full_name?.split(' ')[0] || '',
          last_name: userProfile.last_name || userProfile.full_name?.split(' ').slice(1).join(' ') || '',
          phone: userProfile.phone || '',
        },
        orderV2.id,
        orderV2.order_number,
        orderV2.final_price,
        product?.name || 'Unknown Product',
        tariff?.name || orderMeta.tariff_name || 'Unknown Tariff',
        gcOfferId ? Number(gcOfferId) : null,
        gcDealNumber
      );

      results.getcourse_sync = gcResult.success;
      if (gcResult.error) results.getcourse_error = gcResult.error;
      if (gcResult.gcOrderId) results.getcourse_order_id = gcResult.gcOrderId;
      if (gcResult.gcDealNumber) results.gc_deal_number = gcResult.gcDealNumber;
      // IMPORTANT: getcourse_order_id (deal_id from GC) is what we need for updates!

      // Update order meta with GC sync result
      // CRITICAL: getcourse_order_id is the real GetCourse deal_id for updates!
      await supabase
        .from('orders_v2')
        .update({
          meta: {
            ...(orderV2.meta || {}),
            gc_sync: gcResult.success,
            gc_sync_at: now.toISOString(),
            getcourse_order_id: gcResult.gcOrderId || null, // Real GC deal_id for updates!
            gc_deal_number: gcResult.gcDealNumber || gcDealNumber, // Our reference number
            gc_error: gcResult.error || null,
          },
        })
        .eq('id', orderV2.id);
    } else {
      results.getcourse_sync = false;
      results.getcourse_error = 'No user profile found';
    }

    console.log(`[Test Payment Direct] Completed for order ${orderV2.id}:`, results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        order: {
          id: orderV2.id,
          order_number: orderV2.order_number,
          is_trial: orderV2.is_trial,
          customer_email: orderV2.customer_email,
        },
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Test payment direct error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
