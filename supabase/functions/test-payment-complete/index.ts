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
  gcOfferId: number | null
): Promise<{ success: boolean; error?: string; gcOrderId?: string }> {
  const gcApiKey = Deno.env.get('GETCOURSE_API_KEY');
  const gcEmailRaw = Deno.env.get('GETCOURSE_EMAIL') || 'gorbova';
  
  // Handle both formats: full URL (https://xxx.getcourse.ru) or just account name
  let gcAccount = gcEmailRaw;
  if (gcEmailRaw.includes('getcourse.ru')) {
    const match = gcEmailRaw.match(/(?:https?:\/\/)?([^.]+)\.getcourse\.ru/);
    gcAccount = match ? match[1] : 'gorbova';
  }
  
  if (!gcApiKey) {
    console.log('[Test Payment] GetCourse API key not configured');
    return { success: false, error: 'API key not configured' };
  }

  try {
    const gcUrl = `https://${gcAccount}.getcourse.ru/pl/api/deals`;
    console.log('[Test Payment] GC URL:', gcUrl);
    
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
        deal_number: generateDealNumber(orderNumber),
        deal_cost: amount,
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Тест-оплата через админку. Заказ: ${orderNumber}. Тариф: ${tariffName}`,
      },
    };

    // Add offer_code if available
    if (gcOfferId) {
      dealData.deal.offer_code = gcOfferId.toString();
    }

    console.log('[Test Payment] Sending to GetCourse:', JSON.stringify(dealData));
    
    // Use URLSearchParams with Base64-encoded params like bepaid-webhook does
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', gcApiKey);
    // CRITICAL: Use btoa(unescape(encodeURIComponent(...))) for proper encoding
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(dealData)))));

    const response = await fetch(gcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const responseText = await response.text();
    console.log('[Test Payment] GetCourse response:', responseText);
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error('[Test Payment] Failed to parse GC response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }

    // Check result.success, not top-level success (which is just API call status)
    if (result.result?.success === true) {
      return { 
        success: true, 
        gcOrderId: result.result?.deal_id?.toString()
      };
    } else {
      const errorMsg = result.result?.error_message || result.error_message || JSON.stringify(result);
      return { 
        success: false, 
        error: errorMsg 
      };
    }
  } catch (error) {
    console.error('[Test Payment] GetCourse sync error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Simulate payment completion for testing purposes
// Only accessible by super admins

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is super admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is super admin
    const { data: roles } = await supabase
      .from('user_roles_v2')
      .select('roles(code)')
      .eq('user_id', user.id);

    const isSuperAdmin = roles?.some((r: any) =>
      r.roles?.code === 'super_admin' || r.roles?.code === 'superadmin'
    );

    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only super admins can use this feature' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Test Payment] Super admin ${user.email} simulating payment for order ${orderId}`);

    const now = new Date();

    const results: Record<string, any> = {
      order_updated: false,
      payment_created: false,
      subscription_created: false,
      entitlement_created: false,
      telegram_access_granted: 0,
    };

    // -------------------------
    // V2 flow (preferred)
    // -------------------------
    const { data: orderV2 } = await supabase
      .from('orders_v2')
      .select('*, products_v2(id, name, code, telegram_club_id), tariffs(id, name, code, access_days, getcourse_offer_id)')
      .eq('id', orderId)
      .maybeSingle();

    if (orderV2) {
      if (!orderV2.user_id || !orderV2.product_id) {
        return new Response(
          JSON.stringify({ error: 'Order is missing user_id or product_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const product = (orderV2 as any).products_v2;
      const tariff = (orderV2 as any).tariffs;
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

      // Calculate access days: priority - offer > order meta > tariff
      const accessDays = orderV2.is_trial
        ? (offerTrialDays || orderMeta.trial_days || tariff?.trial_days || 5)
        : (tariff?.access_days || 30);

      console.log(`[Test Payment] Trial=${orderV2.is_trial}, accessDays=${accessDays}, offerTrialDays=${offerTrialDays}, metaTrialDays=${orderMeta.trial_days}`);

      const accessStartAt = now.toISOString();
      const accessEndAt = orderV2.is_trial && orderV2.trial_end_at
        ? new Date(orderV2.trial_end_at)
        : new Date(now.getTime() + accessDays * 24 * 60 * 60 * 1000);

      // Mark order paid
      const testUid = `TEST-${Date.now()}`;
      const { error: orderUpdateError } = await supabase
        .from('orders_v2')
        .update({
          status: 'paid',
          paid_amount: orderV2.final_price,
          meta: {
            ...(orderV2.meta || {}),
            test_payment: true,
            test_payment_by: user.email,
            test_payment_at: now.toISOString(),
            bepaid_uid: testUid,
          },
          updated_at: now.toISOString(),
        })
        .eq('id', orderV2.id);

      if (!orderUpdateError) results.order_updated = true;

      // Create succeeded payment record for history
      const { data: paymentV2, error: paymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: orderV2.id,
          user_id: orderV2.user_id,
          amount: orderV2.final_price,
          currency: orderV2.currency,
          status: 'succeeded',
          provider: 'admin_test',
          paid_at: now.toISOString(),
          is_recurring: false,
          meta: {
            test_payment: true,
            test_payment_by: user.email,
          },
        })
        .select('id')
        .single();

      if (!paymentError && paymentV2?.id) {
        results.payment_created = true;
        // Link payment id into order meta
        await supabase
          .from('orders_v2')
          .update({
            meta: {
              ...(orderV2.meta || {}),
              payment_id: paymentV2.id,
              test_payment: true,
              test_payment_by: user.email,
              test_payment_at: now.toISOString(),
              bepaid_uid: testUid,
            },
            updated_at: now.toISOString(),
          })
          .eq('id', orderV2.id);
      }

      // Create subscription
      // For trials, set next_charge_at to trial end date for auto-charge
      const nextChargeAt = orderV2.is_trial ? accessEndAt.toISOString() : null;
      
      const { error: subError } = await supabase
        .from('subscriptions_v2')
        .insert({
          user_id: orderV2.user_id,
          product_id: orderV2.product_id,
          tariff_id: orderV2.tariff_id,
          order_id: orderV2.id,
          status: orderV2.is_trial ? 'trial' : 'active',
          is_trial: !!orderV2.is_trial,
          auto_renew: !!orderV2.is_trial, // Enable auto-renew for trial subscriptions
          access_start_at: accessStartAt,
          access_end_at: accessEndAt.toISOString(),
          trial_end_at: orderV2.is_trial ? accessEndAt.toISOString() : null,
          payment_method_id: (orderV2.meta as any)?.payment_method_id || null,
          payment_token: null,
          next_charge_at: nextChargeAt,
          updated_at: now.toISOString(),
        });

      if (!subError) results.subscription_created = true;

      // Entitlement (used by access checks)
      if (product?.code) {
        const { error: entError } = await supabase
          .from('entitlements')
          .upsert(
            {
              user_id: orderV2.user_id,
              product_code: product.code,
              status: 'active',
              expires_at: accessEndAt.toISOString(),
              meta: { source: 'admin_test', order_id: orderV2.id },
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
            club_ids: [product.telegram_club_id],
            duration_days: accessDays,
          },
        });
        if (!grantRes.error) results.telegram_access_granted = 1;
      }

      // GetCourse sync
      const gcOfferId = offerGetcourseId || orderMeta.getcourse_offer_id || tariff?.getcourse_offer_id || null;
      
      // Get user profile for GetCourse
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('email, full_name, first_name, last_name, phone')
        .eq('user_id', orderV2.user_id)
        .maybeSingle();

      if (userProfile?.email) {
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
          gcOfferId ? Number(gcOfferId) : null
        );

        results.getcourse_sync = gcResult.success;
        if (gcResult.error) results.getcourse_error = gcResult.error;
        if (gcResult.gcOrderId) results.getcourse_order_id = gcResult.gcOrderId;

        // Update order meta with GC sync result
        await supabase
          .from('orders_v2')
          .update({
            meta: {
              ...(orderV2.meta || {}),
              gc_sync: gcResult.success,
              gc_sync_at: now.toISOString(),
              getcourse_order_id: gcResult.gcOrderId || null,
              gc_error: gcResult.error || null,
            },
          })
          .eq('id', orderV2.id);
      } else {
        results.getcourse_sync = false;
        results.getcourse_error = 'No user profile found';
      }

      // Audit log
      await supabase
        .from('audit_logs')
        .insert({
          action: 'test_payment_complete',
          actor_user_id: user.id,
          target_user_id: orderV2.user_id,
          meta: { order_id: orderV2.id, results },
        });

      console.log(`[Test Payment] Completed (v2) for order ${orderV2.id}:`, results);

      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------
    // Legacy fallback (orders)
    // -------------------------
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, products(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabase
      .from('orders')
      .update({
        status: 'completed',
        bepaid_uid: `TEST-${Date.now()}`,
        payment_method: 'test_payment',
        meta: {
          ...order.meta,
          test_payment: true,
          test_payment_by: user.email,
          test_payment_at: new Date().toISOString(),
        },
      })
      .eq('id', orderId);

    results.order_updated = true;

    await supabase
      .from('audit_logs')
      .insert({
        action: 'test_payment_complete',
        actor_user_id: user.id,
        target_user_id: order.user_id,
        meta: { order_id: orderId, results },
      });

    console.log(`[Test Payment] Completed (legacy) for order ${orderId}:`, results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Test payment error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
