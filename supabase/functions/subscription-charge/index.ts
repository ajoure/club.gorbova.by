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

// PATCH 2: Classify failure reasons for diagnostics
interface DiagnosticResult {
  subscription_id: string;
  user_id: string;
  status: string;
  next_charge_at: string | null;
  access_end_at: string | null;
  charge_attempts: number;
  failure_reason: string;
  payment_method_id: string | null;
  payment_method_status: string | null;
  has_token: boolean;
  amount: number | null;
  currency: string;
  user_email: string | null;
  user_name: string | null;
  ready_to_charge: boolean;
}

function classifyFailureReason(sub: any): string {
  if (!sub.payment_method_id) return 'no_card';
  if (!sub.payment_methods?.provider_token) return 'no_token';
  if (sub.payment_methods?.status !== 'active') return 'pm_inactive';
  if ((sub.charge_attempts || 0) >= 3) return 'max_attempts';
  
  // Check cooldown (6 hours since last attempt)
  const lastAttempt = sub.meta?.last_charge_attempt_at;
  if (lastAttempt) {
    const hoursSinceLastAttempt = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAttempt < 6) return 'cooldown';
  }
  
  return 'ready';
}

// PATCH 4: Check correlation issues between next_charge_at and access_end_at
interface CorrelationIssue {
  subscription_id: string;
  user_id: string;
  issue_type: string;
  next_charge_at: string | null;
  access_end_at: string | null;
  gap_days: number | null;
}

async function getCorrelationIssues(supabase: any): Promise<CorrelationIssue[]> {
  const issues: CorrelationIssue[] = [];
  const now = new Date();

  // Find subscriptions without next_charge_at
  const { data: noChargeDate } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, next_charge_at, access_end_at')
    .in('status', ['active', 'trial'])
    .eq('auto_renew', true)
    .is('next_charge_at', null)
    .limit(50);

  for (const sub of noChargeDate || []) {
    issues.push({
      subscription_id: sub.id,
      user_id: sub.user_id,
      issue_type: 'no_next_charge_at',
      next_charge_at: sub.next_charge_at,
      access_end_at: sub.access_end_at,
      gap_days: null,
    });
  }

  // Find subscriptions where access ends before charge
  const { data: accessBeforeCharge } = await supabase
    .from('subscriptions_v2')
    .select('id, user_id, next_charge_at, access_end_at')
    .in('status', ['active', 'trial'])
    .eq('auto_renew', true)
    .not('next_charge_at', 'is', null)
    .not('access_end_at', 'is', null)
    .limit(100);

  for (const sub of accessBeforeCharge || []) {
    if (sub.access_end_at && sub.next_charge_at) {
      const accessEnd = new Date(sub.access_end_at);
      const chargeAt = new Date(sub.next_charge_at);
      const gapDays = Math.round((chargeAt.getTime() - accessEnd.getTime()) / (1000 * 60 * 60 * 24));
      
      if (accessEnd < chargeAt) {
        issues.push({
          subscription_id: sub.id,
          user_id: sub.user_id,
          issue_type: 'access_ends_before_charge',
          next_charge_at: sub.next_charge_at,
          access_end_at: sub.access_end_at,
          gap_days: gapDays,
        });
      } else if (gapDays < -7) {
        issues.push({
          subscription_id: sub.id,
          user_id: sub.user_id,
          issue_type: 'large_gap',
          next_charge_at: sub.next_charge_at,
          access_end_at: sub.access_end_at,
          gap_days: gapDays,
        });
      }
    }
  }

  return issues;
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
          ? `<p style="color: #d97706;">⚠️ Мы повторим попытку списания через 12 часов. Осталось попыток: ${attemptsLeft}</p>`
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

⚠️ Мы повторим попытку списания через 12 часов.

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
  amount_source?: string;
}

// PATCH 3: Check idempotency (6-hour cooldown)
function isInCooldown(sub: any): boolean {
  const lastAttempt = sub.meta?.last_charge_attempt_at;
  if (!lastAttempt) return false;
  
  const hoursSinceLastAttempt = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastAttempt < 6;
}

// Attempt to charge a subscription using saved payment token
async function chargeSubscription(
  supabase: any,
  subscription: any,
  bepaidConfig: any
): Promise<ChargeResult> {
  const { id, user_id, payment_token, payment_method_id, tariffs, next_charge_at, is_trial, order_id, tariff_id, meta: subMeta } = subscription;
  
  // PATCH 3: Idempotency check - skip if in cooldown
  if (isInCooldown(subscription)) {
    console.log(`Subscription ${id}: Cooldown active (last attempt < 6h ago), skipping`);
    return { subscription_id: id, success: false, error: 'Cooldown: retry too soon' };
  }
  
  // === CRITICAL FIX: Only charge if payment_method is linked and active ===
  if (!payment_method_id) {
    console.log(`Subscription ${id}: No payment_method_id linked, skipping charge`);
    
    try {
      await supabase.functions.invoke('telegram-send-notification', {
        body: {
          user_id: user_id,
          message: '⚠️ Не удалось продлить подписку: карта не привязана.\n\n' +
            'Чтобы продолжить пользоваться сервисом, привяжите карту в личном кабинете:\n' +
            '🔗 https://club.gorbova.by/settings/payment-methods',
        }
      });
    } catch (notifyErr) {
      console.error(`Failed to send card-link notification to user ${user_id}:`, notifyErr);
    }
    
    return { subscription_id: id, success: false, error: 'No payment method linked - card not visible to user' };
  }
  
  // Verify payment method is active
  const { data: paymentMethod } = await supabase
    .from('payment_methods')
    .select('id, status, provider_token')
    .eq('id', payment_method_id)
    .single();
  
  if (!paymentMethod) {
    console.log(`Subscription ${id}: payment_method ${payment_method_id} not found`);
    return { subscription_id: id, success: false, error: 'Payment method not found' };
  }
  
  if (paymentMethod.status !== 'active') {
    console.log(`Subscription ${id}: payment_method ${payment_method_id} is ${paymentMethod.status}, not active`);
    
    try {
      await supabase.functions.invoke('telegram-send-notification', {
        body: {
          user_id: user_id,
          message: '⚠️ Не удалось продлить подписку: привязанная карта неактивна.\n\n' +
            'Привяжите новую карту в личном кабинете:\n' +
            '🔗 https://club.gorbova.by/settings/payment-methods',
        }
      });
    } catch (notifyErr) {
      console.error(`Failed to send card-inactive notification to user ${user_id}:`, notifyErr);
    }
    
    return { subscription_id: id, success: false, error: `Payment method status: ${paymentMethod.status}` };
  }
  
  const effectiveToken = paymentMethod.provider_token;
  
  if (!effectiveToken) {
    console.log(`Subscription ${id}: payment_method ${payment_method_id} has no provider_token`);
    return { subscription_id: id, success: false, error: 'Payment method has no token' };
  }

  const tariff = tariffs;
  if (!tariff) {
    return { subscription_id: id, success: false, error: 'No tariff linked' };
  }

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
  let amountSource: string = 'unknown'; // PATCH 5: Track amount source
  
  // For trial subscriptions, get the linked auto_charge_offer_id and its amount
  if (is_trial) {
    let autoChargeOfferId = orderMeta.auto_charge_offer_id || subMeta?.auto_charge_offer_id;
    
    if (!autoChargeOfferId) {
      const { data: trialOffer } = await supabase
        .from('tariff_offers')
        .select('auto_charge_offer_id, auto_charge_amount')
        .eq('tariff_id', tariff_id)
        .eq('offer_type', 'trial')
        .eq('is_active', true)
        .limit(1)
        .single();
      
      autoChargeOfferId = trialOffer?.auto_charge_offer_id;
      
      if (!autoChargeOfferId && trialOffer?.auto_charge_amount) {
        amount = Number(trialOffer.auto_charge_amount);
        amountSource = 'trial_auto_charge_amount';
        console.log(`Trial subscription ${id}: using legacy auto_charge_amount ${amount}`);
      }
    }
    
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
        amountSource = 'auto_charge_offer';
        console.log(`Trial subscription ${id}: using linked offer "${chargeOffer.button_label}" with amount ${amount}, GC offer: ${fullPaymentGcOfferId}`);
      }
    }
    
    // Final fallback
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
        amountSource = 'fallback_pay_now_offer';
        console.log(`Trial subscription ${id}: using fallback primary offer with amount ${amount}`);
      } else {
        amount = tariff.original_price || 0;
        amountSource = 'tariff_original_price';
        console.log(`Trial subscription ${id}: using tariff original_price ${amount}`);
      }
    }
  } else {
    // Regular subscription
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
    amountSource = 'tariff_price';
  }

  if (!amount || amount <= 0) {
    return { subscription_id: id, success: false, error: 'Invalid charge amount' };
  }

  // PATCH 5: Log amount calculation
  await supabase.from('audit_logs').insert({
    action: 'subscription.charge_amount_calculated',
    actor_type: 'system',
    actor_user_id: null,
    actor_label: 'subscription-charge',
    target_user_id: user_id,
    meta: {
      subscription_id: id,
      amount,
      currency,
      source: amountSource,
      tariff_id,
      offer_id: fullPaymentOfferId,
    }
  });

  console.log(`Charging subscription ${id}: ${amount} ${currency} (is_trial: ${is_trial}, source: ${amountSource})`);

  // PATCH 3: Record attempt timestamp for idempotency
  await supabase
    .from('subscriptions_v2')
    .update({
      meta: {
        ...(subMeta || {}),
        last_charge_attempt_at: new Date().toISOString(),
        last_charge_billing_period: next_charge_at,
      }
    })
    .eq('id', id);

  const { data: payment, error: paymentError } = await supabase
    .from('payments_v2')
    .insert({
      order_id: orderData.id,
      user_id,
      amount,
      currency,
      status: 'processing',
      provider: 'bepaid',
      payment_token: effectiveToken,
      is_recurring: true,
      installment_number: (subscription.charge_attempts || 0) + 1,
      meta: {
        is_trial_conversion: is_trial,
        full_payment_offer_id: fullPaymentOfferId,
        full_payment_gc_offer_id: fullPaymentGcOfferId,
        amount_source: amountSource,
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

    const bepaidAuth = btoa(`${shopId}:${secretKey}`);

    const chargePayload = {
      request: {
        amount: Math.round(amount * 100),
        currency,
        description: `Subscription renewal - ${tariff.name}`,
        tracking_id: payment.id,
        test: testMode,
        credit_card: {
          token: effectiveToken,
        },
        additional_data: {
          contract: ["recurring"],
        },
      },
    };

    console.log('Sending recurring charge to bePaid Gateway');

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
      await supabase
        .from('payments_v2')
        .update({
          status: 'completed',
          paid_at: new Date().toISOString(),
          provider_payment_id: chargeResult.transaction.uid,
          provider_response: chargeResult,
          card_last4: chargeResult.transaction.credit_card?.last_4,
          card_brand: chargeResult.transaction.credit_card?.brand,
          receipt_url: chargeResult.transaction.receipt_url || null,
        })
        .eq('id', payment.id);

      fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/bepaid-fetch-receipt`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ payment_id: payment.id }),
        }
      ).catch((e) => console.warn(`Receipt fetch failed:`, e));

      // Extend subscription
      const newEndDate = new Date();
      newEndDate.setDate(newEndDate.getDate() + (tariff.access_days || 30));

      const nextChargeDate = new Date(newEndDate);
      nextChargeDate.setDate(nextChargeDate.getDate() - 3);

      await supabase
        .from('subscriptions_v2')
        .update({
          status: 'active',
          is_trial: false,
          access_end_at: newEndDate.toISOString(),
          next_charge_at: nextChargeDate.toISOString(),
          charge_attempts: 0,
          meta: {
            ...(subMeta || {}),
            last_charge_attempt_at: new Date().toISOString(),
            last_successful_charge_at: new Date().toISOString(),
          }
        })
        .eq('id', id);

      // Send to GetCourse if this was a trial conversion
      if (is_trial && fullPaymentGcOfferId && orderData.customer_email) {
        console.log(`Sending trial conversion to GetCourse: offer=${fullPaymentGcOfferId}`);
        
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

      // Send success notifications
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

      // Notify admins
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, phone, telegram_username')
          .eq('user_id', user_id)
          .single();

        const formattedDate = newEndDate.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });

        const adminMessage = `🔁 <b>Продление подписки</b>\n\n` +
          `👤 <b>Клиент:</b> ${profile?.full_name || 'Не указано'}\n` +
          `📧 Email: ${profile?.email || 'Не указан'}\n` +
          `📱 Телефон: ${profile?.phone || 'Не указан'}\n` +
          (profile?.telegram_username ? `💬 Telegram: @${profile.telegram_username}\n` : '') +
          `\n📦 <b>Тариф:</b> ${tariff.name || 'N/A'}\n` +
          `💵 Сумма: ${amount} ${currency}\n` +
          `📆 Доступ до: ${formattedDate}\n` +
          `🆔 Подписка: ${id}`;

        const { data: notifyData, error: notifyError } = await supabase.functions.invoke('telegram-notify-admins', {
          body: { 
            message: adminMessage, 
            parse_mode: 'HTML',
            source: 'subscription_charge',
            payment_id: payment.id,
          },
        });

        if (notifyError) {
          console.error('Admin notification invoke error:', notifyError);
        } else if (notifyData?.sent === 0) {
          console.warn('Admin notification sent=0:', notifyData);
        } else {
          console.log('Admin notification sent for renewal:', notifyData);
        }
      } catch (adminNotifyError) {
        console.error('Admin notification error (non-critical):', adminNotifyError);
      }

      return { subscription_id: id, success: true, payment_id: payment.id, amount_source: amountSource };
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

      // PATCH 6: Update subscription status - NO early revoke
      if (attempts >= maxAttempts) {
        // Check if access has also expired before revoking
        const accessEndAt = new Date(subscription.access_end_at);
        const now = new Date();
        
        if (accessEndAt < now) {
          // Both max attempts reached AND access expired - revoke
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'expired',
              charge_attempts: attempts,
              meta: {
                ...(subMeta || {}),
                last_charge_attempt_at: new Date().toISOString(),
                last_charge_error: errorMsg,
              }
            })
            .eq('id', id);

          await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id,
              reason: 'payment_failed_max_attempts',
            },
          });
        } else {
          // Max attempts but access still valid - just mark past_due, don't revoke yet
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'past_due',
              charge_attempts: attempts,
              meta: {
                ...(subMeta || {}),
                last_charge_attempt_at: new Date().toISOString(),
                last_charge_error: errorMsg,
                max_attempts_reached: true,
              }
            })
            .eq('id', id);
        }
      } else {
        // Not at max attempts yet - schedule next try (next cron run in ~12h)
        await supabase
          .from('subscriptions_v2')
          .update({
            status: 'past_due',
            charge_attempts: attempts,
            meta: {
              ...(subMeta || {}),
              last_charge_attempt_at: new Date().toISOString(),
              last_charge_error: errorMsg,
            }
          })
          .eq('id', id);
      }

      // Send failure notifications
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
        amount_source: amountSource,
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

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'execute'; // 'dry_run' | 'execute'
    const source = body.source || 'manual'; // 'cron-morning' | 'cron-evening' | 'manual'

    const now = new Date();
    const nowIso = now.toISOString();

    console.log(`Starting subscription charge job... Mode: ${mode}, Source: ${source}`);

    // PATCH 2: DRY-RUN mode - only diagnostics, no charges
    if (mode === 'dry_run') {
      // Get due subscriptions with diagnostic info
      const { data: dueSubscriptions } = await supabase
        .from('subscriptions_v2')
        .select(`
          id,
          user_id,
          status,
          next_charge_at,
          access_end_at,
          charge_attempts,
          payment_method_id,
          tariff_id,
          meta,
          payment_methods (
            id,
            status,
            provider_token,
            last4,
            brand
          ),
          profiles!subscriptions_v2_user_id_fkey (
            email,
            full_name
          )
        `)
        .lte('next_charge_at', nowIso)
        .in('status', ['active', 'trial', 'past_due'])
        .lt('charge_attempts', 3)
        .limit(100);

      const diagnostics: DiagnosticResult[] = (dueSubscriptions || []).map((sub: any) => ({
        subscription_id: sub.id,
        user_id: sub.user_id,
        status: sub.status,
        next_charge_at: sub.next_charge_at,
        access_end_at: sub.access_end_at,
        charge_attempts: sub.charge_attempts || 0,
        failure_reason: classifyFailureReason(sub),
        payment_method_id: sub.payment_method_id,
        payment_method_status: sub.payment_methods?.status || null,
        has_token: !!sub.payment_methods?.provider_token,
        amount: null, // Would need price lookup
        currency: 'BYN',
        user_email: sub.profiles?.email || null,
        user_name: sub.profiles?.full_name || null,
        ready_to_charge: classifyFailureReason(sub) === 'ready',
      }));

      // PATCH 4: Get correlation issues
      const correlationIssues = await getCorrelationIssues(supabase);

      const summary = {
        mode: 'dry_run',
        run_at: nowIso,
        source,
        total_due: diagnostics.length,
        ready_to_charge: diagnostics.filter(d => d.ready_to_charge).length,
        no_card: diagnostics.filter(d => d.failure_reason === 'no_card').length,
        no_token: diagnostics.filter(d => d.failure_reason === 'no_token').length,
        pm_inactive: diagnostics.filter(d => d.failure_reason === 'pm_inactive').length,
        max_attempts: diagnostics.filter(d => d.failure_reason === 'max_attempts').length,
        cooldown: diagnostics.filter(d => d.failure_reason === 'cooldown').length,
        diagnostics,
        correlation_issues: correlationIssues,
      };

      return new Response(JSON.stringify(summary), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE mode - actually charge subscriptions
    // Find subscriptions that need to be charged (with payment_method linked)
    const { data: subscriptions, error: queryError } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        tariffs(id, name, access_days)
      `)
      .lte('next_charge_at', nowIso)
      .in('status', ['active', 'trial', 'past_due'])
      .not('payment_method_id', 'is', null)
      .lt('charge_attempts', 3)
      .limit(50); // STOP-condition: max 50 per run

    if (queryError) {
      console.error('Query error:', queryError);
      throw queryError;
    }

    console.log(`Found ${subscriptions?.length || 0} subscriptions to charge`);

    // Get bePaid config
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
      console.log(`Subscription ${sub.id}: ${result.success ? 'charged' : 'failed'} (${result.error || 'ok'})`);
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
      .lte('trial_end_at', nowIso)
      .not('payment_method_id', 'is', null)
      .limit(50);

    for (const sub of trialEnding || []) {
      const tariff = sub.tariffs as any;
      
      if (tariff?.trial_auto_charge && sub.payment_method_id) {
        await supabase
          .from('subscriptions_v2')
          .update({
            next_charge_at: nowIso,
            is_trial: false,
          })
          .eq('id', sub.id);

        const result = await chargeSubscription(supabase, sub, bepaidConfig);
        results.push(result);
        console.log(`Trial auto-charge ${sub.id}: ${result.success ? 'charged' : 'failed'}`);
      } else {
        // No auto-charge, expire the subscription only if access_end_at has passed
        const accessEndAt = new Date(sub.access_end_at);
        if (accessEndAt < now) {
          await supabase
            .from('subscriptions_v2')
            .update({
              status: 'expired',
              is_trial: false,
            })
            .eq('id', sub.id);

          await supabase.functions.invoke('telegram-revoke-access', {
            body: {
              user_id: sub.user_id,
              reason: 'trial_ended_no_payment',
            },
          });
        }

        results.push({ 
          subscription_id: sub.id, 
          success: false, 
          error: 'Trial ended, no auto-charge or no card',
        });
      }
    }

    const summary = {
      mode: 'execute',
      source,
      run_at: nowIso,
      total: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      no_card: results.filter(r => r.error?.includes('No payment')).length,
      results,
    };

    // PATCH 7: SYSTEM ACTOR audit log
    await supabase.from('audit_logs').insert({
      action: 'subscription.charge_cron_completed',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'subscription-charge',
      meta: {
        source,
        mode,
        run_at: nowIso,
        total_processed: results.length,
        success_count: results.filter(r => r.success).length,
        failed_count: results.filter(r => !r.success).length,
        no_card_count: results.filter(r => r.error?.includes('No payment')).length,
      }
    });

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
