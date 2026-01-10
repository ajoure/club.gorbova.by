import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Format currency helper
function formatCurrency(amount: number, currency: string = 'BYN'): string {
  return `${amount.toFixed(2)} ${currency}`;
}

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

// Send email notification for successful renewal
async function sendRenewalSuccessEmail(
  supabase: any,
  userId: string,
  productName: string,
  tariffName: string,
  amount: number,
  currency: string,
  newExpiryDate: Date
): Promise<void> {
  try {
    // Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .single();

    let email = profile?.email;
    if (!email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      email = authUser?.user?.email;
    }

    if (!email) return;

    const formattedDate = newExpiryDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const bodyHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #059669; font-size: 24px; margin-bottom: 20px;">✅ Подписка успешно продлена!</h1>
        <p>Здравствуйте!</p>
        <p>Ваша подписка была успешно продлена.</p>
        
        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
          <p style="margin: 0 0 8px 0;"><strong>🎯 Тариф:</strong> ${tariffName}</p>
          <p style="margin: 0 0 8px 0;"><strong>💳 Списано:</strong> ${formatCurrency(amount, currency)}</p>
          <p style="margin: 0;"><strong>📆 Доступ до:</strong> ${formattedDate}</p>
        </div>
        
        <p>Спасибо, что остаётесь с нами!</p>
        
        <p style="margin-top: 24px;">
          <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Мои подписки
          </a>
        </p>
        
        <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
          С уважением,<br>Команда клуба
        </p>
      </div>
    `;

    await supabase.functions.invoke('send-email', {
      body: {
        to: email,
        subject: '✅ Подписка успешно продлена',
        html: bodyHtml,
      },
    });

    console.log(`Sent renewal success email to ${email}`);
  } catch (err) {
    console.error('Failed to send renewal success email:', err);
  }
}

// Send email notification for failed payment
async function sendPaymentFailureEmail(
  supabase: any,
  userId: string,
  productName: string,
  amount: number,
  currency: string,
  errorMessage: string,
  attemptsLeft: number
): Promise<void> {
  try {
    // Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .single();

    let email = profile?.email;
    if (!email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      email = authUser?.user?.email;
    }

    if (!email) return;

    const russianError = translatePaymentError(errorMessage);

    const bodyHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #dc2626; font-size: 24px; margin-bottom: 20px;">❌ Платёж не прошёл</h1>
        <p>Здравствуйте!</p>
        <p>К сожалению, не удалось списать оплату за продление подписки.</p>
        
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
          <p style="margin: 0 0 8px 0;"><strong>💳 Сумма:</strong> ${formatCurrency(amount, currency)}</p>
          <p style="margin: 0;"><strong>⚠️ Причина:</strong> ${russianError}</p>
        </div>
        
        <p><strong>Что можно сделать:</strong></p>
        <ul style="color: #4b5563;">
          <li>Проверьте баланс карты</li>
          <li>Убедитесь, что карта не заблокирована</li>
          <li>Попробуйте привязать другую карту</li>
        </ul>
        
        ${attemptsLeft > 0 
          ? `<p style="color: #d97706;">⚠️ Мы повторим попытку списания через 24 часа. Осталось попыток: ${attemptsLeft}</p>`
          : `<p style="color: #dc2626;">❗ Это была последняя попытка. Доступ будет закрыт.</p>`
        }
        
        <p style="margin-top: 24px;">
          <a href="https://club.gorbova.by/settings/payment-methods" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Обновить карту
          </a>
        </p>
        
        <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
          С уважением,<br>Команда клуба
        </p>
      </div>
    `;

    await supabase.functions.invoke('send-email', {
      body: {
        to: email,
        subject: '❌ Платёж по подписке не прошёл',
        html: bodyHtml,
      },
    });

    console.log(`Sent payment failure email to ${email}`);
  } catch (err) {
    console.error('Failed to send payment failure email:', err);
  }
}

// Send Telegram notification about successful renewal
async function sendRenewalSuccessTelegram(
  supabase: any,
  userId: string,
  productName: string,
  tariffName: string,
  amount: number,
  currency: string,
  newExpiryDate: Date
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

    const userName = profile.full_name?.split(' ')[0] || 'Клиент';
    const formattedDate = newExpiryDate.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long'
    });

    const message = `✅ *Подписка успешно продлена!*

${userName}, ваша подписка была автоматически продлена.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
💳 *Списано:* ${formatCurrency(amount, currency)}
📆 *Доступ до:* ${formattedDate}

Спасибо, что остаётесь с нами! 🎉`;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    console.log(`Sent renewal success notification to user ${userId} via Telegram`);
  } catch (err) {
    console.error('Failed to send renewal success notification:', err);
  }
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
💳 *Сумма:* ${formatCurrency(amount, currency)}
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
  const { id, user_id, payment_token, tariffs, next_charge_at, is_trial, order_id, tariff_id, meta: subMeta } = subscription;
  
  if (!payment_token) {
    return { subscription_id: id, success: false, error: 'No payment token saved' };
  }

  // Get tariff price
  const tariff = tariffs;
  if (!tariff) {
    return { subscription_id: id, success: false, error: 'No tariff linked' };
  }

  // Get order info to find the original offer
  const { data: orderData } = await supabase
    .from('orders_v2')
    .select('id, meta, customer_email')
    .eq('id', order_id)
    .single();

  if (!orderData) {
    return { subscription_id: id, success: false, error: 'No order linked' };
  }

  const orderMeta = (orderData.meta || {}) as Record<string, any>;
  let amount: number = 0;
  let currency = 'BYN';
  let fullPaymentOfferId: string | null = null;
  let fullPaymentGcOfferId: string | null = null;
  
  // For trial subscriptions, get the linked auto_charge_offer_id and its amount
  if (is_trial) {
    // First check if we have auto_charge_offer_id in order meta or fetch from trial offer
    let autoChargeOfferId = orderMeta.auto_charge_offer_id || subMeta?.auto_charge_offer_id;
    
    if (!autoChargeOfferId) {
      // Find the trial offer to get auto_charge_offer_id
      const { data: trialOffer } = await supabase
        .from('tariff_offers')
        .select('auto_charge_offer_id, auto_charge_amount')
        .eq('tariff_id', tariff_id)
        .eq('offer_type', 'trial')
        .eq('is_active', true)
        .limit(1)
        .single();
      
      autoChargeOfferId = trialOffer?.auto_charge_offer_id;
      
      // Fallback to deprecated auto_charge_amount if no linked offer
      if (!autoChargeOfferId && trialOffer?.auto_charge_amount) {
        amount = Number(trialOffer.auto_charge_amount);
        console.log(`Trial subscription ${id}: using legacy auto_charge_amount ${amount}`);
      }
    }
    
    // If we have auto_charge_offer_id, get the amount and GC offer from that offer
    if (autoChargeOfferId) {
      const { data: chargeOffer } = await supabase
        .from('tariff_offers')
        .select('id, amount, getcourse_offer_id, button_label')
        .eq('id', autoChargeOfferId)
        .single();
      
      if (chargeOffer) {
        amount = Number(chargeOffer.amount);
        fullPaymentOfferId = chargeOffer.id;
        fullPaymentGcOfferId = chargeOffer.getcourse_offer_id;
        console.log(`Trial subscription ${id}: using linked offer "${chargeOffer.button_label}" with amount ${amount}, GC offer: ${fullPaymentGcOfferId}`);
      }
    }
    
    // Final fallback: find primary pay_now offer for this tariff
    if (!amount || amount <= 0) {
      const { data: fallbackOffer } = await supabase
        .from('tariff_offers')
        .select('id, amount, getcourse_offer_id')
        .eq('tariff_id', tariff_id)
        .eq('offer_type', 'pay_now')
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .single();
      
      if (fallbackOffer) {
        amount = Number(fallbackOffer.amount);
        fullPaymentOfferId = fallbackOffer.id;
        fullPaymentGcOfferId = fallbackOffer.getcourse_offer_id;
        console.log(`Trial subscription ${id}: using fallback primary offer with amount ${amount}`);
      } else {
        // Last resort: use tariff original_price
        amount = tariff.original_price || 0;
        console.log(`Trial subscription ${id}: using tariff original_price ${amount}`);
      }
    }
  } else {
    // Regular subscription - get current price from tariff_prices
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

    amount = priceData.final_price || priceData.price;
    currency = priceData.currency || 'BYN';
  }

  if (!amount || amount <= 0) {
    return { subscription_id: id, success: false, error: 'Invalid charge amount' };
  }

  console.log(`Charging subscription ${id}: ${amount} ${currency} (is_trial: ${is_trial})`);

  const { data: payment, error: paymentError } = await supabase
    .from('payments_v2')
    .insert({
      order_id: orderData.id,
      user_id,
      amount,
      currency,
      status: 'processing',
      provider: 'bepaid',
      payment_token,
      is_recurring: true,
      installment_number: (subscription.charge_attempts || 0) + 1,
      meta: {
        is_trial_conversion: is_trial,
        full_payment_offer_id: fullPaymentOfferId,
        full_payment_gc_offer_id: fullPaymentGcOfferId,
      },
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

      // Send to GetCourse if this was a trial conversion
      if (is_trial && fullPaymentGcOfferId && orderData.customer_email) {
        console.log(`Sending trial conversion to GetCourse: offer=${fullPaymentGcOfferId}`);
        
        // Get user profile for name
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name, phone')
          .eq('user_id', user_id)
          .single();

        const gcOfferId = typeof fullPaymentGcOfferId === 'string' 
          ? parseInt(fullPaymentGcOfferId, 10) 
          : fullPaymentGcOfferId;

        const orderNumber = `CONV-${new Date().getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;

        try {
          const apiKey = Deno.env.get('GETCOURSE_API_KEY');
          if (apiKey && gcOfferId) {
            const gcParams = {
              user: {
                email: orderData.customer_email,
                phone: profile?.phone || undefined,
                first_name: profile?.first_name || undefined,
                last_name: profile?.last_name || undefined,
              },
              system: { refresh_if_exists: 1 },
              deal: {
                offer_code: gcOfferId.toString(),
                deal_cost: amount,
                deal_status: 'payed',
                deal_is_paid: 1,
                payment_type: 'CARD',
                manager_email: 'info@ajoure.by',
                deal_comment: `Конверсия триала в полную подписку. Order: ${orderNumber}`,
              },
            };

            const formData = new URLSearchParams();
            formData.append('action', 'add');
            formData.append('key', apiKey);
            formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(gcParams)))));

            const gcResponse = await fetch('https://gorbova.getcourse.ru/pl/api/deals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString(),
            });
            const gcResult = await gcResponse.text();
            console.log('GetCourse trial conversion response:', gcResult);
          }
        } catch (gcErr) {
          console.error('GetCourse sync error:', gcErr);
        }
      }

      // Grant Telegram access
      await supabase.functions.invoke('telegram-grant-access', {
        body: {
          user_id,
          duration_days: tariff.access_days || 30,
        },
      });

      // Send success notifications (Telegram + Email)
      await sendRenewalSuccessTelegram(
        supabase,
        user_id,
        tariff.name || 'Подписка',
        tariff.name || 'Стандартный',
        amount,
        currency,
        newEndDate
      );
      await sendRenewalSuccessEmail(
        supabase,
        user_id,
        tariff.name || 'Подписка',
        tariff.name || 'Стандартный',
        amount,
        currency,
        newEndDate
      );

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

      // Send failure notifications (Telegram + Email)
      const attemptsLeft = maxAttempts - attempts;
      await sendPaymentFailureNotification(
        supabase,
        user_id,
        tariff.name || 'Подписка',
        amount,
        currency,
        errorMsg
      );
      await sendPaymentFailureEmail(
        supabase,
        user_id,
        tariff.name || 'Подписка',
        amount,
        currency,
        errorMsg,
        attemptsLeft
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
