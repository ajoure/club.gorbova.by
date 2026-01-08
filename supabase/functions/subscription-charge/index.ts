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
    'Payment failed': 'Платёж не прошёл',
    'payment_failed': 'Платёж не прошёл',
    'Token expired': 'Сохранённая карта устарела',
    'token_expired': 'Сохранённая карта устарела',
    'Invalid token': 'Ошибка привязанной карты',
    'invalid_token': 'Ошибка привязанной карты',
  };

  if (errorMap[error]) return errorMap[error];
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  return `Ошибка платежа: ${error}`;
}

// Send Telegram notification about payment failure
async function sendPaymentFailureNotification(
  supabase: any,
  userId: string,
  productName: string,
  amount: number,
  currency: string,
  errorMessage: string
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_status, full_name')
      .eq('user_id', userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      return;
    }

    const { data: linkBot } = await supabase
      .from('telegram_bots')
      .select('token')
      .eq('is_link_bot', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!linkBot?.token) return;

    const userName = profile.full_name || 'Клиент';
    const russianError = translatePaymentError(errorMessage);
    
    const message = `❌ *Платёж по подписке не прошёл*

${userName}, к сожалению, не удалось продлить подписку.

📦 *Продукт:* ${productName}
💳 *Сумма:* ${amount} ${currency}
⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте баланс карты
• Убедитесь, что карта не заблокирована
• Попробуйте оплатить другой картой

⚠️ Мы повторим попытку списания через 24 часа.

🔗 [Обновить карту](https://club.gorbova.by/settings/payment-methods)`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    console.log(`Sent subscription failure notification to user ${userId} via Telegram`);
  } catch (err) {
    console.error('Failed to send subscription failure notification:', err);
  }
}

interface ChargeResult {
  subscription_id: string;
  success: boolean;
  error?: string;
  payment_id?: string;
}

// Attempt to charge a subscription using saved payment token
async function chargeSubscription(
  supabase: any,
  subscription: any,
  bepaidConfig: any
): Promise<ChargeResult> {
  const { id, user_id, payment_token, tariffs, next_charge_at } = subscription;
  
  if (!payment_token) {
    return { subscription_id: id, success: false, error: 'No payment token saved' };
  }

  // Get tariff price
  const tariff = tariffs;
  if (!tariff) {
    return { subscription_id: id, success: false, error: 'No tariff linked' };
  }

  // Get current price for tariff
  const { data: priceData } = await supabase
    .from('tariff_prices')
    .select('price, final_price, currency')
    .eq('tariff_id', tariff.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!priceData) {
    return { subscription_id: id, success: false, error: 'No active price for tariff' };
  }

  const amount = priceData.final_price || priceData.price;
  const currency = priceData.currency || 'BYN';

  console.log(`Charging subscription ${id}: ${amount} ${currency}`);

  // Create payment record
  const { data: order } = await supabase
    .from('orders_v2')
    .select('id')
    .eq('id', subscription.order_id)
    .single();

  if (!order) {
    return { subscription_id: id, success: false, error: 'No order linked' };
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments_v2')
    .insert({
      order_id: order.id,
      user_id,
      amount,
      currency,
      status: 'processing',
      provider: 'bepaid',
      payment_token,
      is_recurring: true,
      installment_number: (subscription.charge_attempts || 0) + 1,
    })
    .select()
    .single();

  if (paymentError) {
    return { subscription_id: id, success: false, error: paymentError.message };
  }

  // Call bePaid to charge token
  try {
    const shopId = bepaidConfig?.shop_id || Deno.env.get('BEPAID_SHOP_ID');
    const secretKey = bepaidConfig?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const testMode = bepaidConfig?.test_mode ?? true;

    if (!shopId || !secretKey) {
      throw new Error('bePaid not configured');
    }

    // Use bePaid Gateway API for token charges
    const bepaidAuth = btoa(`${shopId}:${secretKey}`);

    const chargePayload = {
      request: {
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        description: `Subscription renewal - ${tariff.name}`,
        tracking_id: payment.id,
        test: testMode,
        credit_card: {
          token: payment_token,
        },
        additional_data: {
          contract: ["recurring"],
        },
      },
    };

    console.log('Sending recurring charge to bePaid Gateway');

    // Charge using token via Gateway API
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

    const chargeResult = await chargeResponse.json();
    console.log('bePaid charge result:', chargeResult);

    if (chargeResult.transaction?.status === 'successful') {
      // Update payment
      await supabase
        .from('payments_v2')
        .update({
          status: 'completed',
          paid_at: new Date().toISOString(),
          provider_payment_id: chargeResult.transaction.uid,
          provider_response: chargeResult,
          card_last4: chargeResult.transaction.credit_card?.last_4,
          card_brand: chargeResult.transaction.credit_card?.brand,
        })
        .eq('id', payment.id);

      // Extend subscription
      const newEndDate = new Date();
      newEndDate.setDate(newEndDate.getDate() + (tariff.access_days || 30));

      const nextChargeDate = new Date(newEndDate);
      nextChargeDate.setDate(nextChargeDate.getDate() - 3); // Charge 3 days before expiry

      await supabase
        .from('subscriptions_v2')
        .update({
          status: 'active',
          is_trial: false,
          access_end_at: newEndDate.toISOString(),
          next_charge_at: nextChargeDate.toISOString(),
          charge_attempts: 0,
        })
        .eq('id', id);

      // Grant Telegram access
      await supabase.functions.invoke('telegram-grant-access', {
        body: {
          user_id,
          duration_days: tariff.access_days || 30,
        },
      });

      return { subscription_id: id, success: true, payment_id: payment.id };
    } else {
      // Payment failed
      const attempts = (subscription.charge_attempts || 0) + 1;
      const maxAttempts = 3;
      const errorMsg = chargeResult.transaction?.message || 'Payment failed';

      await supabase
        .from('payments_v2')
        .update({
          status: 'failed',
          error_message: errorMsg,
          provider_response: chargeResult,
        })
        .eq('id', payment.id);

      // Update subscription status
      if (attempts >= maxAttempts) {
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'expired',
            charge_attempts: attempts,
          })
          .eq('id', id);

        // Revoke Telegram access
        await supabase.functions.invoke('telegram-revoke-access', {
          body: {
            user_id,
            reason: 'payment_failed_max_attempts',
          },
        });
      } else {
        // Schedule retry in 24 hours
        const retryDate = new Date();
        retryDate.setHours(retryDate.getHours() + 24);

        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'past_due',
            charge_attempts: attempts,
            next_charge_at: retryDate.toISOString(),
          })
          .eq('id', id);
      }

      // Send Telegram notification about failed payment
      await sendPaymentFailureNotification(
        supabase,
        user_id,
        tariff.name || 'Подписка',
        amount,
        currency,
        errorMsg
      );

      return { 
        subscription_id: id, 
        success: false, 
        error: errorMsg,
      };
    }
  } catch (err) {
    console.error('Charge error:', err);
    
    await supabase
      .from('payments_v2')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
      })
      .eq('id', payment.id);

    return { 
      subscription_id: id, 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error',
    };
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

    const now = new Date().toISOString();

    console.log('Starting subscription charge job...');

    // Find subscriptions that need to be charged
    // next_charge_at <= now AND status IN (active, trial, past_due) AND payment_token IS NOT NULL
    const { data: subscriptions, error: queryError } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        tariffs(id, name, access_days)
      `)
      .lte('next_charge_at', now)
      .in('status', ['active', 'trial', 'past_due'])
      .not('payment_token', 'is', null)
      .lt('charge_attempts', 3);

    if (queryError) {
      console.error('Query error:', queryError);
      throw queryError;
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to charge`);

    // Get bePaid config from integration_instances
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .eq('status', 'connected')
      .limit(1)
      .single();

    const bepaidConfig = bepaidInstance?.config || {};

    const results: ChargeResult[] = [];

    for (const sub of subscriptions || []) {
      const result = await chargeSubscription(supabase, sub, bepaidConfig);
      results.push(result);
      console.log(`Subscription ${sub.id}: ${result.success ? 'charged' : 'failed'}`);
    }

    // Also check for trial subscriptions that need to auto-charge
    const { data: trialEnding } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        tariffs(id, name, access_days, trial_auto_charge)
      `)
      .eq('status', 'trial')
      .eq('is_trial', true)
      .lte('trial_end_at', now)
      .not('payment_token', 'is', null);

    for (const sub of trialEnding || []) {
      const tariff = sub.tariffs as any;
      
      if (tariff?.trial_auto_charge && sub.payment_token) {
        // Set next_charge_at to trigger immediate charge
        await supabase
          .from('subscriptions_v2')
          .update({
            next_charge_at: now,
            is_trial: false,
          })
          .eq('id', sub.id);

        const result = await chargeSubscription(supabase, sub, bepaidConfig);
        results.push(result);
        console.log(`Trial auto-charge ${sub.id}: ${result.success ? 'charged' : 'failed'}`);
      } else {
        // No auto-charge, expire the subscription
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'expired',
            is_trial: false,
          })
          .eq('id', sub.id);

        // Revoke access
        await supabase.functions.invoke('telegram-revoke-access', {
          body: {
            user_id: sub.user_id,
            reason: 'trial_ended_no_payment',
          },
        });

        results.push({ 
          subscription_id: sub.id, 
          success: false, 
          error: 'Trial ended, no auto-charge',
        });
      }
    }

    const summary = {
      total: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };

    console.log('Subscription charge job completed:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Subscription charge error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
