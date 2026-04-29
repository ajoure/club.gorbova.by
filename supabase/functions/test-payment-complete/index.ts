import { createClient } from 'npm:@supabase/supabase-js@2';
import { findProfileByAnyId } from '../_shared/user-resolver.ts';
import { applyCrmStageOnTerminal } from '../_shared/crm-routing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      
      // REMOVED: No longer look up offer from DB - use ONLY offer_id from meta
      // If offer_id is passed in meta, it will be used. Otherwise, fallback to tariff's getcourse_offer_id
      console.log(`[Test Payment] Using offer from meta: offerGetcourseId=${offerGetcourseId}, offer_id=${orderMeta.offer_id}`);

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

      // CRM routing — Layer A: применить closed_won из snapshot (admin test terminal)
      try {
        const crmRes = await applyCrmStageOnTerminal(supabase, orderV2.id, 'success', 'admin_test_payment_complete');
        results.crm_stage_applied = crmRes.applied;
        results.crm_stage_reason = crmRes.reason;
      } catch (e) {
        console.error('[Test Payment] crm-routing apply failed:', e);
        results.crm_stage_error = e instanceof Error ? e.message : String(e);
      }

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

      // PATCH-SIMULATION-CANONICAL:
      // Симуляция должна идти через канонический grant-access-for-order,
      // а НЕ ручным insert subscriptions_v2 + entitlements.
      // Это делает проверочный путь идентичным реальной оплате (та же логика
      // продления, primary entitlement integrity, secondary grants).
      try {
        const grantRes = await supabase.functions.invoke('grant-access-for-order', {
          body: {
            orderId: orderV2.id,
            customAccessDays: accessDays,
            grantTelegram: false,  // обработаем ниже отдельно
            grantGetcourse: false, // обработаем ниже отдельно
          },
        });

        if (grantRes.error) {
          console.error('[Test Payment] grant-access-for-order error:', grantRes.error);
          results.grant_access_invoked = false;
          results.subscription_error = grantRes.error.message;
        } else {
          const grantData = grantRes.data as Record<string, any>;
          results.grant_access_invoked = true;
          results.subscription_action = grantData?.results?.subscription?.action || null;
          results.subscription_created = !!grantData?.results?.subscription;
          results.entitlement_action = grantData?.results?.entitlement?.action || null;
          results.entitlement_created = !!grantData?.results?.entitlement;
        }
      } catch (grantErr) {
        console.error('[Test Payment] grant-access-for-order exception:', grantErr);
        results.grant_access_invoked = false;
        results.subscription_error = grantErr instanceof Error ? grantErr.message : String(grantErr);
      }

      // Resolve profile_id (used by GetCourse sync below)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', orderV2.user_id)
        .single();
      const profileId = profileData?.id || orderV2.profile_id || null;

      // Telegram access
      if (product?.telegram_club_id) {
        const grantRes = await supabase.functions.invoke('telegram-grant-access', {
           body: {
            user_id: orderV2.user_id,
            club_id: product.telegram_club_id,
            duration_days: accessDays,
          },
        });
        if (!grantRes.error) results.telegram_access_granted = 1;
      }

      // GetCourse sync
      const gcOfferId = offerGetcourseId || orderMeta.getcourse_offer_id || tariff?.getcourse_offer_id || null;
      
      // Get user profile for GetCourse (handle profile.id vs user_id)
      let userProfile: any = null;
      
      // First try by user_id
      const { data: profileByUserId } = await supabase
        .from('profiles')
        .select('email, full_name, first_name, last_name, phone')
        .eq('user_id', orderV2.user_id)
        .maybeSingle();
      
      if (profileByUserId) {
        userProfile = profileByUserId;
      } else {
        // Fallback: try by profile id (in case user_id was actually profile.id)
        const { profile: profileById, resolvedFrom } = await findProfileByAnyId(supabase, orderV2.user_id);
        if (profileById) {
          userProfile = profileById;
          console.log(`[Test Payment] Found profile by ${resolvedFrom} fallback`);
        }
      }

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

      // Audit log — PATCH-SIMULATION-CANONICAL proof: симуляция прошла через grant-access-for-order.
      await supabase
        .from('audit_logs')
        .insert({
          action: 'test_payment_complete',
          actor_type: 'user',
          actor_user_id: user.id,
          actor_label: 'test-payment-complete',
          target_user_id: orderV2.user_id,
          meta: {
            order_id: orderV2.id,
            results,
            canonical_simulation: true,
            grant_path: 'grant-access-for-order',
          },
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
