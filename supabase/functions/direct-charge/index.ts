import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Translate bePaid error messages to Russian
function translatePaymentError(error: string): string {
  const errorMap: Record<string, string> = {
    'Insufficient funds': 'Недостаточно средств на карте',
    'insufficient_funds': 'Недостаточно средств на карте',
    'Card declined': 'Карта отклонена банком',
    'card_declined': 'Карта отклонена банком',
    'Expired card': 'Срок действия карты истёк',
    'expired_card': 'Срок действия карты истёк',
    'Invalid card': 'Неверные данные карты',
    'invalid_card': 'Неверные данные карты',
    'Do not honor': 'Операция отклонена банком',
    'do_not_honor': 'Операция отклонена банком',
    'Lost card': 'Карта заблокирована (утеряна)',
    'lost_card': 'Карта заблокирована (утеряна)',
    'Stolen card': 'Карта заблокирована (украдена)',
    'stolen_card': 'Карта заблокирована (украдена)',
    'Card restricted': 'Ограничения на карте',
    'card_restricted': 'Ограничения на карте',
    'Transaction not permitted': 'Операция не разрешена для данной карты',
    'transaction_not_permitted': 'Операция не разрешена для данной карты',
    'Invalid amount': 'Неверная сумма',
    'invalid_amount': 'Неверная сумма',
    'Authentication failed': 'Ошибка аутентификации 3D Secure',
    'authentication_failed': 'Ошибка аутентификации 3D Secure',
    '3-D Secure authentication failed': 'Ошибка подтверждения 3D Secure',
    'Payment failed': 'Платёж не прошёл',
    'payment_failed': 'Платёж не прошёл',
    'Token expired': 'Сохранённая карта устарела',
    'token_expired': 'Сохранённая карта устарела',
    'Invalid token': 'Ошибка привязанной карты',
    'invalid_token': 'Ошибка привязанной карты',
  };

  // Try exact match first
  if (errorMap[error]) return errorMap[error];
  
  // Try case-insensitive partial match
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  
  // Return original with prefix if no translation found
  return `Ошибка платежа: ${error}`;
}

// Send order to GetCourse
interface GetCourseUserData {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

// Generate a consistent deal_number from orderNumber for GetCourse updates
function generateDealNumber(orderNumber: string): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    const char = orderNumber.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

async function sendToGetCourse(
  userData: GetCourseUserData,
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log(`No getcourse_offer_id for tariff: ${tariffCode}, skipping GetCourse sync`);
    return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
  }
  
  try {
    console.log(`Sending order to GetCourse: email=${userData.email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    // Generate a consistent deal_number from our order_number for future updates
    const dealNumber = generateDealNumber(orderNumber);
    console.log(`Generated deal_number=${dealNumber} from orderNumber=${orderNumber}`);
    
    const params = {
      user: {
        email: userData.email,
        phone: userData.phone || undefined,
        first_name: userData.firstName || undefined,
        last_name: userData.lastName || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        // CRITICAL: Pass our own deal_number so we can update this deal later
        deal_number: dealNumber,
        offer_code: offerId.toString(),
        deal_cost: amount / 100, // Convert from kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse params:', JSON.stringify(params, null, 2));
    
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
    console.log('GetCourse response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    // Check result.success, not top-level success (which is just API call status)
    if (data.result?.success === true) {
      console.log('Order successfully sent to GetCourse, deal_id:', data.result?.deal_id, 'deal_number:', dealNumber);
      return { success: true, gcOrderId: data.result?.deal_id?.toString(), gcDealNumber: dealNumber };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

interface DirectChargeRequest {
  productId: string;
  tariffCode: string;
  offerId?: string; // Specific offer ID for pricing
  isTrial?: boolean;
  trialDays?: number;
  paymentMethodId?: string; // If not provided, use default card
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get bePaid credentials from integration_instances (primary) or fallback to env
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    const bepaidSecretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const bepaidShopIdFromInstance = bepaidInstance?.config?.shop_id || null;
    
    if (!bepaidSecretKey) {
      console.error('bePaid secret key not configured');
      return new Response(JSON.stringify({ success: false, error: 'Платёжная система не настроена' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Using bePaid credentials from:', bepaidInstance?.config?.secret_key ? 'integration_instances' : 'env');

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: DirectChargeRequest = await req.json();
    const { productId, tariffCode, offerId, isTrial, trialDays, paymentMethodId } = body;

    console.log(`Direct charge for user ${user.id}: product=${productId}, tariff=${tariffCode}, offerId=${offerId}, trial=${isTrial}`);

    // Get user's payment method
    let paymentMethodQuery = supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');
    
    if (paymentMethodId) {
      paymentMethodQuery = paymentMethodQuery.eq('id', paymentMethodId);
    } else {
      paymentMethodQuery = paymentMethodQuery.eq('is_default', true);
    }

    const { data: paymentMethod } = await paymentMethodQuery.single();

    if (!paymentMethod) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No payment method found',
        requiresTokenization: true,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Using payment method: ${paymentMethod.brand} **** ${paymentMethod.last4}`);

    // Get product and tariff info
    const { data: product } = await supabase
      .from('products_v2')
      .select('id, name, currency, telegram_club_id')
      .eq('id', productId)
      .eq('is_active', true)
      .single();

    if (!product) {
      return new Response(JSON.stringify({ success: false, error: 'Product not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tariff } = await supabase
      .from('tariffs')
      .select('id, name, code, access_days, original_price, trial_days, trial_price, trial_auto_charge, getcourse_offer_id')
      .eq('code', tariffCode)
      .eq('product_id', productId)
      .eq('is_active', true)
      .single();

    if (!tariff) {
      return new Response(JSON.stringify({ success: false, error: 'Tariff not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get offer data - PRIORITY: use offerId if provided
    let offer: any = null;
    
    if (offerId) {
      // Use specific offer by ID
      const { data: specificOffer } = await supabase
        .from('tariff_offers')
        .select('*')
        .eq('id', offerId)
        .eq('is_active', true)
        .single();
      
      if (specificOffer) {
        offer = specificOffer;
        console.log(`Using specific offer by ID: ${offerId}, amount: ${offer.amount}`);
      } else {
        console.warn(`Offer not found or inactive: ${offerId}, falling back to tariff lookup`);
      }
    }
    
    // Fallback to tariff-based lookup
    if (!offer) {
      const offerType = isTrial ? 'trial' : 'pay_now';
      const { data: tariffOffer } = await supabase
        .from('tariff_offers')
        .select('*')
        .eq('tariff_id', tariff.id)
        .eq('offer_type', offerType)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .single();
      
      offer = tariffOffer;
    }

    // Check if this is an internal installment payment
    const isInternalInstallment = offer?.payment_method === 'internal_installment' && offer?.installment_count > 1;
    const installmentCount = isInternalInstallment ? offer.installment_count : 1;
    const installmentIntervalDays = offer?.installment_interval_days ?? 30;
    const firstPaymentDelayDays = offer?.first_payment_delay_days ?? 0;
    
    // For installments, amount is divided into payments
    const totalAmount = offer?.amount ?? (isTrial ? tariff.trial_price : tariff.original_price) ?? 0;
    const amount = isInternalInstallment 
      ? Math.round((totalAmount / installmentCount) * 100) / 100 
      : totalAmount;
    
    const effectiveTrialDays = offer?.trial_days ?? trialDays ?? tariff.trial_days ?? 5;
    const autoChargeAmount = offer?.auto_charge_amount ?? tariff.original_price ?? 0;
    const autoChargeOfferId = offer?.auto_charge_offer_id ?? null; // Reference to pay_now offer for auto-charge
    const autoChargeAfterTrial = offer?.auto_charge_after_trial ?? tariff.trial_auto_charge ?? true;
    const isRecurringSubscription = offer?.requires_card_tokenization ?? false;
    
    console.log(`Installment mode: ${isInternalInstallment}, count: ${installmentCount}, first payment: ${amount} ${product.currency}`);

    console.log(`Charge amount: ${amount} ${product.currency} (total: ${totalAmount}), trial=${isTrial}, days=${effectiveTrialDays}`);

    // Check if user already has an active subscription for this product
    // For trial - block if already used trial for this product
    // For regular purchase - allow and extend access (only if same tariff)
    // IMPORTANT: exclude canceled subscriptions (canceled_at IS NOT NULL) - they should not be reused
    const { data: existingSub } = await supabase
      .from('subscriptions_v2')
      .select('id, status, access_end_at, access_start_at, is_trial, canceled_at, tariff_id, order_id')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .in('status', ['active', 'trial'])
      .is('canceled_at', null) // Only extend subscriptions that are not canceled
      .gte('access_end_at', new Date().toISOString())
      .order('access_end_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Block trial if user already used trial for this product
    if (isTrial) {
      const { data: usedTrial } = await supabase
        .from('subscriptions_v2')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .eq('is_trial', true)
        .limit(1)
        .maybeSingle();

      if (usedTrial) {
        console.log(`User already used trial for this product`);
        return new Response(JSON.stringify({
          success: false,
          error: 'Вы уже использовали пробный период для этого продукта',
          alreadyUsedTrial: true,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // For regular purchase with active subscription of SAME tariff - extend access period
    // If different tariff (upgrade/downgrade) - create new subscription with proration
    let extendFromDate: Date | null = null;
    const isSameTariff = existingSub && existingSub.tariff_id === tariff.id;
    
    // Proration calculation for tariff change
    interface ProrationResult {
      bonusDays: number;
      unusedValue: number;
      oldDailyRate: number;
      newDailyRate: number;
      remainingDays: number;
      oldTariffId: string;
    }
    let prorationResult: ProrationResult | null = null;
    
    if (existingSub && isSameTariff && !isTrial) {
      extendFromDate = new Date(existingSub.access_end_at);
      console.log(`User has active subscription for same tariff until ${extendFromDate.toISOString()}, will extend from that date`);
    } else if (existingSub && !isSameTariff && !isTrial) {
      console.log(`User is upgrading/changing tariff from ${existingSub.tariff_id} to ${tariff.id}, calculating proration...`);
      
      // Calculate proration: convert unused days from old tariff to bonus days on new tariff
      // 1. Get paid amount from old order
      const { data: oldOrder } = await supabase
        .from('orders_v2')
        .select('paid_amount, final_price')
        .eq('id', existingSub.order_id)
        .single();
      
      // 2. Get access_days from old tariff
      const { data: oldTariff } = await supabase
        .from('tariffs')
        .select('access_days')
        .eq('id', existingSub.tariff_id)
        .single();
      
      if (oldOrder && oldTariff?.access_days) {
        const oldPaidAmount = oldOrder.paid_amount || oldOrder.final_price || 0;
        const now = new Date();
        const accessEnd = new Date(existingSub.access_end_at);
        const remainingMs = accessEnd.getTime() - now.getTime();
        const remainingDays = Math.max(0, remainingMs / (24 * 60 * 60 * 1000));
        
        if (remainingDays > 0 && oldPaidAmount > 0) {
          // Calculate daily rates (in kopecks)
          const oldDailyRate = oldPaidAmount / oldTariff.access_days;
          const unusedValue = oldDailyRate * remainingDays;
          const newDailyRate = amount / tariff.access_days;
          
          // Bonus days = unused value / new daily rate
          const bonusDays = newDailyRate > 0 ? Math.floor(unusedValue / newDailyRate) : 0;
          
          prorationResult = {
            bonusDays,
            unusedValue,
            oldDailyRate,
            newDailyRate,
            remainingDays,
            oldTariffId: existingSub.tariff_id,
          };
          
          console.log(`Proration calculated: ${remainingDays.toFixed(1)} days remaining, ` +
            `unused value: ${(unusedValue / 100).toFixed(2)} ${product.currency}, ` +
            `bonus days: ${bonusDays}`);
        }
      }
    }

    // Use shop_id from integration_instances if available, fallback to payment_settings
    const { data: settings } = await supabase
      .from('payment_settings')
      .select('key, value')
      .in('key', ['bepaid_shop_id', 'bepaid_test_mode']);

    const settingsMap: Record<string, string> = settings?.reduce(
      (acc: Record<string, string>, s: { key: string; value: string }) => ({ ...acc, [s.key]: s.value }),
      {}
    ) || {};

    // Priority: integration_instances > payment_settings > default
    const shopId = bepaidShopIdFromInstance || settingsMap['bepaid_shop_id'] || '33524';
    const testMode = settingsMap['bepaid_test_mode'] === 'true';

    // Generate order number
    const orderNumber = `ORD-${new Date().getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;

    // Create order - use total amount for installments
    const { data: order, error: orderError } = await supabase
      .from('orders_v2')
      .insert({
        order_number: orderNumber,
        user_id: user.id,
        product_id: productId,
        tariff_id: tariff.id,
        customer_email: user.email,
        base_price: totalAmount,
        final_price: totalAmount,
        currency: product.currency,
        is_trial: isTrial || false,
        trial_end_at: isTrial ? new Date(Date.now() + effectiveTrialDays * 24 * 60 * 60 * 1000).toISOString() : null,
        status: 'pending',
        meta: {
          payment_method_id: paymentMethod.id,
          direct_charge: true,
          auto_charge_after_trial: autoChargeAfterTrial,
          auto_charge_amount: autoChargeAmount,
          auto_charge_offer_id: autoChargeOfferId, // Reference to pay_now offer for auto-charge
          is_installment: isInternalInstallment,
          installment_count: isInternalInstallment ? installmentCount : null,
          first_payment_amount: isInternalInstallment ? amount : null,
          offer_id: offer?.id || null,
          getcourse_offer_id: offer?.getcourse_offer_id || tariff.getcourse_offer_id || null,
          tariff_code: tariffCode,
          trial_days: isTrial ? effectiveTrialDays : null,
          is_trial: isTrial || false,
        },
      })
      .select()
      .single();

    if (orderError) {
      console.error('Order creation error:', orderError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to create order' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Created order ${order.id}`);

    // For trial with 0 amount, just activate without charging
    if (isTrial && amount === 0) {
      console.log('Trial with 0 amount - activating without charge');

      // Create subscription
      const trialEndAt = new Date(Date.now() + effectiveTrialDays * 24 * 60 * 60 * 1000);
      const nextChargeAt = autoChargeAfterTrial 
        ? new Date(trialEndAt.getTime() - 24 * 60 * 60 * 1000) // 1 day before trial ends
        : null;

      const { data: subscription, error: subError } = await supabase
        .from('subscriptions_v2')
        .insert({
          user_id: user.id,
          product_id: productId,
          tariff_id: tariff.id,
          order_id: order.id,
          status: 'trial',
          is_trial: true,
          auto_renew: !!autoChargeAfterTrial, // Enable auto-renew for trial subscriptions with auto-charge
          access_start_at: new Date().toISOString(),
          access_end_at: trialEndAt.toISOString(),
          trial_end_at: trialEndAt.toISOString(),
          payment_method_id: paymentMethod.id,
          payment_token: paymentMethod.provider_token,
          next_charge_at: nextChargeAt?.toISOString() || null,
        })
        .select()
        .single();

      if (subError) {
        console.error('Subscription creation error:', subError);
        return new Response(JSON.stringify({ success: false, error: 'Failed to create subscription' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Mark order as paid (trial amount = 0 does not create a bePaid charge)
      const { error: orderUpdateError } = await supabase
        .from('orders_v2')
        .update({ status: 'paid', paid_amount: 0 })
        .eq('id', order.id);

      if (orderUpdateError) {
        console.error('Order update error:', orderUpdateError);
      }

      // Create internal payment record for history/audit
      const { error: trialPaymentError } = await supabase
        .from('payments_v2')
        .insert({
          order_id: order.id,
          user_id: user.id,
          amount: 0,
          currency: product.currency,
          status: 'succeeded',
          provider: 'bepaid',
          payment_token: paymentMethod.provider_token,
          is_recurring: false,
          meta: {
            kind: 'trial_activation_no_charge',
            payment_method_id: paymentMethod.id,
          },
        });

      if (trialPaymentError) {
        console.error('Trial payment record error:', trialPaymentError);
      }

      // Grant Telegram access
      if (product.telegram_club_id) {
        await supabase.functions.invoke('telegram-grant-access', {
          body: {
            user_id: user.id,
            duration_days: effectiveTrialDays,
          },
        });
      }

      // GetCourse sync for trial - prefer offer-level getcourse_offer_id, fallback to tariff-level
      const trialGetcourseOfferId = offer?.getcourse_offer_id || tariff.getcourse_offer_id;
      if (trialGetcourseOfferId) {
        console.log(`Syncing trial to GetCourse: offer_id=${trialGetcourseOfferId}`);
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, phone, first_name, last_name')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (profile?.email) {
          const gcResult = await sendToGetCourse(
            {
              email: profile.email,
              phone: profile.phone || null,
              firstName: profile.first_name || null,
              lastName: profile.last_name || null,
            },
            parseInt(trialGetcourseOfferId, 10) || 0,
            order.order_number,
            0, // Trial amount is 0
            tariff.code || tariff.name
          );
          console.log('GetCourse sync result (trial direct-charge):', gcResult);
          
          // Save GetCourse sync result to order meta
          const existingMeta = (order as any).meta || {};
          await supabase
            .from('orders_v2')
            .update({
              meta: {
                ...existingMeta,
                gc_sync_status: gcResult.success ? 'success' : 'failed',
                gc_sync_error: gcResult.error || null,
                gc_order_id: gcResult.gcOrderId || null,
                gc_deal_number: gcResult.gcDealNumber || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', order.id);
        }
      }

      // Notify admins about new trial purchase
      const { data: buyerProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      await supabase.functions.invoke('telegram-notify-admins', {
        body: {
          message: `🆕 Новый триал!\n\n` +
            `👤 ${buyerProfile?.full_name || buyerProfile?.email || 'Неизвестно'}\n` +
            `📧 ${buyerProfile?.email || 'N/A'}\n` +
            `📦 ${product.name}\n` +
            `🏷️ ${tariff.name}\n` +
            `📅 Триал: ${effectiveTrialDays} дней\n` +
            `🔢 Заказ: ${order.order_number}`,
        },
      }).catch(console.error);

      // Audit log
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'subscription.trial_activated',
        meta: {
          order_id: order.id,
          subscription_id: subscription.id,
          product_id: productId,
          tariff_code: tariffCode,
          trial_days: effectiveTrialDays,
          payment_method: `${paymentMethod.brand} **** ${paymentMethod.last4}`,
        },
      });

      console.log(`Trial activated: subscription ${subscription.id}`);

      return new Response(JSON.stringify({
        success: true,
        orderId: order.id,
        subscriptionId: subscription.id,
        isTrial: true,
        trialEndsAt: trialEndAt.toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For paid transactions, charge the card
    console.log(`Charging ${amount} ${product.currency} using token ${paymentMethod.provider_token.substring(0, 8)}...`);

    // Create payment record (amount in BYN, not kopecks - DB stores decimal)
    const { data: payment, error: paymentError } = await supabase
      .from('payments_v2')
      .insert({
        order_id: order.id,
        user_id: user.id,
        amount, // Store in BYN (the charge payload converts to kopecks separately)
        currency: product.currency,
        status: 'processing',
        provider: 'bepaid',
        payment_token: paymentMethod.provider_token,
        is_recurring: isInternalInstallment, // Mark as recurring for installments
        installment_number: isInternalInstallment ? 1 : null,
        meta: { 
          payment_method_id: paymentMethod.id,
          is_installment: isInternalInstallment,
          total_installments: isInternalInstallment ? installmentCount : null,
        },
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to create payment' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call bePaid Gateway API to charge the token
    // Important: For token charges, use gateway.bepaid.by/transactions/payments with additional_data.contract
    const bepaidAuth = btoa(`${shopId}:${bepaidSecretKey}`);

    // Build URLs from the request origin to support preview domains (and avoid hanging redirects).
    const reqOrigin = req.headers.get('origin');
    const reqReferer = req.headers.get('referer');
    const origin = reqOrigin
      || (reqReferer ? new URL(reqReferer).origin : null)
      || 'https://club.gorbova.by';

    // bePaid webhook receiver (so we can finalize payment after 3DS)
    const notificationUrl = `${supabaseUrl}/functions/v1/bepaid-webhook`;

    // Return to purchases with "processing" state. UI will show success ONLY after confirmed provider status.
    const returnUrl = `${origin}/purchases?payment=processing&order=${order.id}`;

    const chargePayload = {
      request: {
        amount: Math.round(amount * 100), // minimal currency units (kopecks)
        currency: product.currency,
        description: isInternalInstallment
          ? `${product.name} - ${tariff.name} (платёж 1/${installmentCount})`
          : (isTrial
            ? `Trial: ${product.name} - ${tariff.name}`
            : `${product.name} - ${tariff.name}`),
        tracking_id: payment.id,
        test: testMode,
        return_url: returnUrl,
        notification_url: notificationUrl,
        // CRITICAL: Skip 3DS for MIT (Merchant Initiated Transactions) with saved card token
        skip_three_d_secure_verification: true,
        credit_card: {
          token: paymentMethod.provider_token,
        },
        additional_data: {
          contract: ["recurring", "unscheduled"],
          // Card on file parameters for MIT - tells bePaid this is a merchant-initiated charge
          card_on_file: {
            initiator: "merchant",
            type: "delayed_charge",
          },
          order_id: order.id,
          payment_id: payment.id,
        },
      },
    };

    console.log('bePaid gateway URLs:', { origin, returnUrl, notificationUrl });

    console.log('Sending charge to bePaid Gateway:', JSON.stringify(chargePayload));

    const chargeResponse = await fetch('https://gateway.bepaid.by/transactions/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${bepaidAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Version': '2',
      },
      body: JSON.stringify(chargePayload),
    });

    // Log response status for debugging
    console.log(`bePaid charge response status: ${chargeResponse.status}`);
    
    const chargeResult = await chargeResponse.json();
    console.log('bePaid charge response:', JSON.stringify(chargeResult));

    // Handle non-200 responses from bePaid
    if (!chargeResponse.ok) {
      const errorMessage = chargeResult.message || chargeResult.error || `bePaid API error: ${chargeResponse.status}`;
      console.error('bePaid API error:', errorMessage, chargeResult);
      
      await supabase
        .from('payments_v2')
        .update({
          status: 'failed',
          error_message: errorMessage,
          provider_response: chargeResult,
        })
        .eq('id', payment.id);

      await supabase
        .from('orders_v2')
        .update({ status: 'failed' })
        .eq('id', order.id);

      return new Response(JSON.stringify({
        success: false,
        error: errorMessage,
        orderId: order.id,
        details: chargeResult,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const txStatus = chargeResult.transaction?.status;
    const txUid = chargeResult.transaction?.uid;
    const redirectUrl = chargeResult.transaction?.redirect_url;

    // 3-D Secure / additional verification required.
    // bePaid returns status=incomplete and provides redirect_url to complete the payment.
    if (txStatus === 'incomplete' && redirectUrl) {
      console.log('Transaction requires 3-D Secure verification, redirecting:', redirectUrl);

      // Persist provider details so the webhook can finalize the order later.
      await supabase
        .from('payments_v2')
        .update({
          status: 'processing',
          provider_payment_id: txUid || null,
          provider_response: chargeResult,
          error_message: chargeResult.transaction?.message || null,
        })
        .eq('id', payment.id);

      await supabase
        .from('orders_v2')
        .update({
          status: 'pending',
          meta: {
            ...(order.meta || {}),
            bepaid_uid: txUid,
            payment_id: payment.id,
            requires_3ds: true,
          },
        })
        .eq('id', order.id);

      return new Response(
        JSON.stringify({
          success: false,
          requiresRedirect: true,
          redirectUrl,
          orderId: order.id,
          paymentId: payment.id,
        }),
        {
          // Important: return 200 so the client does not treat this as a function error.
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (txStatus === 'successful') {
      // Update payment
      const { error: payUpdateError } = await supabase
        .from('payments_v2')
        .update({
          status: 'succeeded',
          paid_at: new Date().toISOString(),
          provider_payment_id: chargeResult.transaction.uid,
          provider_response: chargeResult,
          card_last4: chargeResult.transaction.credit_card?.last_4 || paymentMethod.last4,
          card_brand: chargeResult.transaction.credit_card?.brand || paymentMethod.brand,
        })
        .eq('id', payment.id);

      if (payUpdateError) {
        console.error('Payment update error:', payUpdateError);
      }

      // Update order
      const { error: orderPaidError } = await supabase
        .from('orders_v2')
        .update({
          status: 'paid',
          paid_amount: amount,
          meta: {
            ...(order.meta || {}),
            bepaid_uid: txUid,
            payment_id: payment.id,
          },
        })
        .eq('id', order.id);

      if (orderPaidError) {
        console.error('Order paid update error:', orderPaidError);
      }

      // Create or update subscription
      // Apply proration bonus days if upgrading/downgrading tariff
      const baseAccessDays = isTrial ? effectiveTrialDays : tariff.access_days;
      const prorationBonusDays = prorationResult?.bonusDays || 0;
      const accessDays = baseAccessDays + prorationBonusDays;
      
      if (prorationBonusDays > 0) {
        console.log(`Total access days: ${baseAccessDays} + ${prorationBonusDays} (proration) = ${accessDays}`);
      }
      
      // If extending existing subscription, start from its end date
      const baseDate = extendFromDate || new Date();
      const accessEndAt = new Date(baseDate.getTime() + accessDays * 24 * 60 * 60 * 1000);

      // Set next_charge_at only if this is a recurring subscription or trial with auto-charge
      let nextChargeAt: Date | null = null;
      if (isTrial && autoChargeAfterTrial) {
        nextChargeAt = new Date(accessEndAt.getTime() - 24 * 60 * 60 * 1000);
      } else if (!isTrial && isRecurringSubscription) {
        nextChargeAt = new Date(accessEndAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      }
      // If not recurring subscription (one-time payment), next_charge_at stays null

      let subscription;
      if (existingSub && isSameTariff && !isTrial) {
        // Update existing subscription with extended access (same tariff)
        const { data: updatedSub, error: updateError } = await supabase
          .from('subscriptions_v2')
          .update({
            access_end_at: accessEndAt.toISOString(),
            next_charge_at: nextChargeAt?.toISOString() || null,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSub.id)
          .select()
          .single();

        if (updateError) {
          console.error('Subscription update error:', updateError);
        }
        subscription = updatedSub;
        console.log(`Extended subscription ${existingSub.id} until ${accessEndAt.toISOString()}`);
      } else {
        // Create new subscription (new tariff or upgrade/downgrade with proration)
        const subscriptionMeta = prorationResult ? {
          proration: {
            from_tariff_id: prorationResult.oldTariffId,
            remaining_days: Math.round(prorationResult.remainingDays * 10) / 10,
            unused_value: Math.round(prorationResult.unusedValue),
            bonus_days: prorationResult.bonusDays,
            old_daily_rate: Math.round(prorationResult.oldDailyRate * 100) / 100,
            new_daily_rate: Math.round(prorationResult.newDailyRate * 100) / 100,
          }
        } : undefined;
        
        const { data: newSub, error: subError } = await supabase
          .from('subscriptions_v2')
          .insert({
            user_id: user.id,
            product_id: productId,
            tariff_id: tariff.id,
            order_id: order.id,
            status: isTrial ? 'trial' : 'active',
            is_trial: isTrial || false,
            access_start_at: new Date().toISOString(),
            access_end_at: accessEndAt.toISOString(),
            trial_end_at: isTrial ? accessEndAt.toISOString() : null,
            payment_method_id: paymentMethod.id,
            payment_token: paymentMethod.provider_token,
            next_charge_at: nextChargeAt?.toISOString() || null,
            meta: subscriptionMeta,
          })
          .select()
          .single();

        if (subError) {
          console.error('Subscription creation error:', subError);
        }
        subscription = newSub;
        
        // If upgrading/downgrading - cancel old subscription
        if (existingSub && !isSameTariff) {
          console.log(`Canceling old subscription ${existingSub.id} due to tariff change`);
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'canceled',
              canceled_at: new Date().toISOString(),
              cancel_reason: `Changed to tariff: ${tariff.code}. Proration: ${prorationBonusDays} bonus days applied.`,
            })
            .eq('id', existingSub.id);
        }
      }

      // Create installment payments schedule for internal installment offers
      if (isInternalInstallment && subscription && installmentCount > 1) {
        console.log(`Creating installment schedule: ${installmentCount} payments, interval ${installmentIntervalDays} days`);
        
        const installmentPayments = [];
        const perPaymentAmount = Math.round((totalAmount / installmentCount) * 100) / 100;
        
        for (let i = 0; i < installmentCount; i++) {
          const delayDays = firstPaymentDelayDays + (i * installmentIntervalDays);
          const dueDate = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
          
          installmentPayments.push({
            subscription_id: subscription.id,
            order_id: order.id,
            user_id: user.id,
            payment_number: i + 1,
            total_payments: installmentCount,
            amount: perPaymentAmount,
            currency: product.currency,
            due_date: dueDate.toISOString(),
            status: i === 0 ? 'succeeded' : 'pending', // First payment just completed
            paid_at: i === 0 ? new Date().toISOString() : null,
            payment_id: i === 0 ? payment.id : null,
          });
        }
        
        const { error: instError } = await supabase
          .from('installment_payments')
          .insert(installmentPayments);
        
        if (instError) {
          console.error('Installment payments creation error:', instError);
        } else {
          console.log(`Created ${installmentCount} installment payment records`);
        }
        
        // Update order to show only first payment as paid
        await supabase
          .from('orders_v2')
          .update({
            paid_amount: perPaymentAmount,
            meta: {
              ...(order.meta || {}),
              bepaid_uid: txUid,
              payment_id: payment.id,
              is_installment: true,
              installment_count: installmentCount,
              total_amount: totalAmount,
            },
          })
          .eq('id', order.id);
      }

      // Grant Telegram access
      if (product.telegram_club_id) {
        await supabase.functions.invoke('telegram-grant-access', {
          body: {
            user_id: user.id,
            duration_days: accessDays,
          },
        });
      }

      // GetCourse sync - prefer offer-level getcourse_offer_id, fallback to tariff-level
      const getcourseOfferId = offer?.getcourse_offer_id || tariff.getcourse_offer_id;
      if (getcourseOfferId) {
        console.log(`Syncing to GetCourse: offer_id=${getcourseOfferId}`);
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, phone, first_name, last_name')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (profile?.email) {
          const gcResult = await sendToGetCourse(
            {
              email: profile.email,
              phone: profile.phone || null,
              firstName: profile.first_name || null,
              lastName: profile.last_name || null,
            },
            parseInt(getcourseOfferId, 10) || 0,
            order.order_number,
            amount,
            tariff.code || tariff.name
          );
          console.log('GetCourse sync result (direct-charge):', gcResult);
          
          // Save GetCourse sync result to order meta including deal_number for future updates
          const existingMeta = (order as any).meta || {};
          await supabase
            .from('orders_v2')
            .update({
              meta: {
                ...existingMeta,
                bepaid_uid: txUid,
                payment_id: payment.id,
                gc_sync_status: gcResult.success ? 'success' : 'failed',
                gc_sync_error: gcResult.error || null,
                gc_order_id: gcResult.gcOrderId || null,
                gc_deal_number: gcResult.gcDealNumber || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', order.id);
        }
      }

      // Audit log
      await supabase.from('audit_logs').insert({
        actor_user_id: user.id,
        action: isTrial ? 'subscription.trial_paid' : 'subscription.purchased',
        meta: {
          order_id: order.id,
          payment_id: payment.id,
          subscription_id: subscription?.id,
          amount,
          currency: product.currency,
          tariff_code: tariffCode,
          bepaid_uid: txUid,
        },
      });

      // Notify admins about new purchase
      const { data: buyerProfile } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      await supabase.functions.invoke('telegram-notify-admins', {
        body: {
          message: `💰 Новая покупка!\n\n` +
            `👤 ${buyerProfile?.full_name || buyerProfile?.email || 'Неизвестно'}\n` +
            `📧 ${buyerProfile?.email || 'N/A'}\n` +
            `📦 ${product.name}\n` +
            `🏷️ ${tariff.name}\n` +
            `💵 ${amount} ${product.currency}\n` +
            `🔢 Заказ: ${order.order_number}`,
        },
      }).catch(console.error);

      console.log(`Payment successful: ${payment.id}, subscription: ${subscription?.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          orderId: order.id,
          paymentId: payment.id,
          subscriptionId: subscription?.id,
          isTrial: isTrial || false,
          accessEndsAt: accessEndAt.toISOString(),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Treat all other statuses as failure (but respond with 200 so the UI doesn't blank-screen)
    const errorMessage =
      chargeResult.transaction?.message || chargeResult.errors?.base?.[0] || 'Payment failed';

    await supabase
      .from('payments_v2')
      .update({
        status: 'failed',
        error_message: errorMessage,
        provider_response: chargeResult,
        provider_payment_id: txUid || null,
      })
      .eq('id', payment.id);

    await supabase
      .from('orders_v2')
      .update({ status: 'failed' })
      .eq('id', order.id);

    console.error('Payment failed:', errorMessage);

    // Send Telegram notification about failed payment
    try {
      // Get user's profile with telegram info
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, telegram_link_status, full_name')
        .eq('user_id', user.id)
        .single();

      if (profile?.telegram_user_id && profile.telegram_link_status === 'active') {
        // Get bot token for sending messages
        const { data: linkBot } = await supabase
          .from('telegram_bots')
          .select('token')
          .eq('is_link_bot', true)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (linkBot?.token) {
          const userName = profile.full_name || 'Клиент';
          const russianError = translatePaymentError(errorMessage);
          
          const message = `❌ *Платёж не прошёл*

${userName}, к сожалению, не удалось провести оплату.

📦 *Продукт:* ${product.name}
💳 *Сумма:* ${amount} ${product.currency}
⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте баланс карты
• Убедитесь, что карта не заблокирована
• Попробуйте оплатить другой картой

🔗 [Попробовать снова](https://club.gorbova.by/purchases)`;

          await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: profile.telegram_user_id,
              text: message,
              parse_mode: 'Markdown',
            }),
          });
          console.log('Sent payment failure notification to user via Telegram');
        }
      }
    } catch (notifErr) {
      console.error('Failed to send payment failure notification:', notifErr);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        orderId: order.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Direct charge error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
