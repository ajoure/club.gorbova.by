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
          ? `<p style="color: #d97706;">⚠️ Мы повторим попытку при следующем автоматическом запуске. Осталось попыток: ${attemptsLeft}</p>`
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

⚠️ Мы повторим попытку при следующем автоматическом запуске.

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
  skipped?: boolean;
  skip_reason?: string;
}

// PATCH: Check if charge was already attempted today (UTC date comparison)
function wasChargeAttemptedToday(sub: any): boolean {
  const lastAttempt = sub.meta?.last_charge_attempt_at;
  if (!lastAttempt) return false;
  
  const todayUtc = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const lastAttemptDate = new Date(lastAttempt).toISOString().split('T')[0];
  
  return lastAttemptDate === todayUtc;
}

// ========== GRACE PERIOD HELPERS (PATCH) ==========

// Check if subscription is in expired_reentry state — BLOCK all charges
function isExpiredReentry(sub: any): boolean {
  return sub.grace_period_status === 'expired_reentry';
}

// Check if grace period has expired and needs to be marked
function hasGraceExpired(sub: any, now: Date): boolean {
  if (sub.grace_period_status !== 'in_grace') return false;
  if (!sub.grace_period_ends_at) return false;
  return new Date(sub.grace_period_ends_at) <= now;
}

// Check if subscription needs grace period started
function needsGraceStart(sub: any, now: Date): boolean {
  if (sub.grace_period_started_at) return false; // Already started
  if (!sub.access_end_at) return false;
  return new Date(sub.access_end_at) <= now;
}

// Mark subscription as expired_reentry (after grace period ends)
async function markAsExpiredReentry(
  supabase: any,
  userId: string,
  subId: string,
  subMeta: Record<string, any>
): Promise<void> {
  const now = new Date().toISOString();

  // 1. Update subscription
  await supabase.from('subscriptions_v2').update({
    grace_period_status: 'expired_reentry',
    auto_renew: false,
    updated_at: now,
    meta: {
      ...subMeta,
      grace_expired_at: now,
    },
  }).eq('id', subId);

  // 2. Update profile — NOW mark as former member
  await supabase.from('profiles').update({
    was_club_member: true,
    club_exit_at: now,
    club_exit_reason: 'grace_period_expired',
    reentry_pricing_applies_from: now,
  }).eq('user_id', userId);

  // 3. Record notification event (idempotency)
  await supabase.from('grace_notification_events').insert({
    subscription_id: subId,
    event_type: 'grace_expired',
    channel: 'system',
    meta: { marked_by: 'subscription-charge' },
  }).onConflict('subscription_id,event_type').doNothing();

  // 4. Audit log
  await supabase.from('audit_logs').insert({
    action: 'subscription.grace_expired',
    actor_type: 'system',
    actor_label: 'subscription-charge',
    target_user_id: userId,
    meta: { subscription_id: subId },
  });

  console.log(`Subscription ${subId}: marked as expired_reentry, was_club_member=true`);
}

// Attempt to charge a subscription using saved payment token
async function chargeSubscription(
  supabase: any,
  subscription: any,
  bepaidConfig: any
): Promise<ChargeResult> {
  const { id, user_id, payment_token, payment_method_id, tariffs, next_charge_at, is_trial, order_id, tariff_id, meta: subMeta } = subscription;
  const now = new Date();

  // ========== GRACE PERIOD CHECKS (MUST BE FIRST) ==========
  
  // 1. BLOCK if expired_reentry — no automatic charges allowed after grace expires
  if (isExpiredReentry(subscription)) {
    console.log(`Subscription ${id}: grace_period_status=expired_reentry, BLOCKING charge (manual only)`);
    return { 
      subscription_id: id, 
      success: false, 
      skipped: true, 
      skip_reason: 'grace_expired_manual_only',
      error: 'Grace period expired. Manual payment required at new price.',
    };
  }

  // 2. Check if grace period just expired — mark and block
  if (hasGraceExpired(subscription, now)) {
    console.log(`Subscription ${id}: grace period just expired, marking as expired_reentry`);
    await markAsExpiredReentry(supabase, user_id, id, subMeta || {});
    return { 
      subscription_id: id, 
      success: false, 
      skipped: true, 
      skip_reason: 'grace_just_expired',
      error: 'Grace period just expired. Marked as expired_reentry.',
    };
  }

  // 3. Start grace period if access_end_at passed and grace not started yet
  // DETERMINISTIC: grace_period_started_at = access_end_at (NOT current time)
  if (needsGraceStart(subscription, now)) {
    const accessEndAt = new Date(subscription.access_end_at);
    const recurringSnapshot = subMeta?.recurring_snapshot || {};
    const graceHours = recurringSnapshot.grace_hours || 72;
    const graceEndsAt = new Date(accessEndAt.getTime() + graceHours * 60 * 60 * 1000);

    console.log(`Subscription ${id}: starting grace period, access_end_at=${subscription.access_end_at}, grace_ends_at=${graceEndsAt.toISOString()}`);

    await supabase.from('subscriptions_v2').update({
      grace_period_started_at: accessEndAt.toISOString(),
      grace_period_ends_at: graceEndsAt.toISOString(),
      grace_period_status: 'in_grace',
      updated_at: now.toISOString(),
    }).eq('id', id);

    // Record grace_started event (idempotency)
    await supabase.from('grace_notification_events').insert({
      subscription_id: id,
      event_type: 'grace_started',
      channel: 'system',
      meta: { started_by: 'subscription-charge', access_end_at: subscription.access_end_at },
    }).onConflict('subscription_id,event_type').doNothing();

    // Note: grace_started notification will be sent by subscription-grace-reminders cron
    // Continue with charge attempt (grace allows charges)
  }

  // ========== END GRACE PERIOD CHECKS ==========

  // ========== CHARGE WINDOW CHECK ==========
  // PATCH: Only allow charge if current time is within configured charge windows (±15 min)
  const recurringSnapshotForWindow = subMeta?.recurring_snapshot || {};
  const timezone = recurringSnapshotForWindow.timezone || 'Europe/Minsk';
  const chargeTimesLocal = recurringSnapshotForWindow.charge_times_local || ['09:00', '21:00'];
  const chargeAttemptsPerDay = recurringSnapshotForWindow.charge_attempts_per_day || 2;
  
  // Get current time in the configured timezone
  const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentHour = nowInTz.getHours();
  const currentMinute = nowInTz.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  
  // Check if we're within ±15 minutes of any configured charge time
  const WINDOW_TOLERANCE_MINUTES = 15;
  let isInChargeWindow = false;
  
  for (const timeStr of chargeTimesLocal.slice(0, chargeAttemptsPerDay)) {
    const [h, m] = timeStr.split(':').map(Number);
    const targetMinutes = h * 60 + m;
    const diff = Math.abs(currentTotalMinutes - targetMinutes);
    if (diff <= WINDOW_TOLERANCE_MINUTES || diff >= (24 * 60 - WINDOW_TOLERANCE_MINUTES)) {
      isInChargeWindow = true;
      break;
    }
  }
  
  if (!isInChargeWindow) {
    console.log(`Subscription ${id}: outside charge window (current=${currentHour}:${currentMinute} TZ=${timezone}, windows=${chargeTimesLocal.join(',')})`);
    return {
      subscription_id: id,
      success: false,
      skipped: true,
      skip_reason: 'outside_charge_window',
      error: `Current time not in charge window. Configured: ${chargeTimesLocal.join(', ')} (${timezone})`,
    };
  }
  
  // Check attempts per day limit
  const todayLocalStr = nowInTz.toISOString().split('T')[0];
  const lastAttemptDay = subMeta?.last_charge_attempt_day;
  const attemptsToday = lastAttemptDay === todayLocalStr ? (subMeta?.charge_attempts_today || 0) : 0;
  
  if (attemptsToday >= chargeAttemptsPerDay) {
    console.log(`Subscription ${id}: max attempts (${chargeAttemptsPerDay}) reached for today (${todayLocalStr})`);
    return {
      subscription_id: id,
      success: false,
      skipped: true,
      skip_reason: 'max_attempts_today',
      error: `Already attempted ${attemptsToday} times today (max: ${chargeAttemptsPerDay})`,
    };
  }
  
  // ========== END CHARGE WINDOW CHECK ==========
  
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
      console.error(`Failed to send card-missing notification to user ${user_id}:`, notifyErr);
    }
    
    return { subscription_id: id, success: false, error: 'No payment method linked', skipped: true, skip_reason: 'no_card' };
  }
  
  // Get payment method details
  const { data: paymentMethod, error: pmError } = await supabase
    .from('payment_methods')
    .select('id, status, provider_token, last4, brand')
    .eq('id', payment_method_id)
    .single();
    
  if (pmError || !paymentMethod) {
    console.log(`Subscription ${id}: Failed to fetch payment_method ${payment_method_id}:`, pmError);
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
  let amountSource: string = 'unknown';
  
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
    // Regular subscription - priority hierarchy:
    // 1. subscription.meta.recurring_amount (explicitly set)
    // 2. orders_v2.final_price (original order amount)
    // 3. tariff_offers with linked offer_id
    // 4. tariff_prices (fallback for legacy)
    
    // 1. Check subscription meta for recurring_amount
    if (subMeta?.recurring_amount && Number(subMeta.recurring_amount) > 0) {
      amount = Number(subMeta.recurring_amount);
      currency = subMeta.recurring_currency || 'BYN';
      amountSource = 'subscription_meta_recurring';
      console.log(`Subscription ${id}: using meta.recurring_amount = ${amount}`);
    }
    // 2. Fallback to original order price
    else if (orderData?.final_price && Number(orderData.final_price) > 0) {
      amount = Number(orderData.final_price);
      currency = orderData.currency || 'BYN';
      amountSource = 'order_final_price';
      console.log(`Subscription ${id}: using order.final_price = ${amount}`);
    }
    // 3. Check for linked offer in subscription meta
    else if (subMeta?.offer_id) {
      const { data: linkedOffer } = await supabase
        .from('tariff_offers')
        .select('amount, getcourse_offer_id')
        .eq('id', subMeta.offer_id)
        .maybeSingle();
      
      if (linkedOffer?.amount && Number(linkedOffer.amount) > 0) {
        amount = Number(linkedOffer.amount);
        fullPaymentOfferId = subMeta.offer_id;
        fullPaymentGcOfferId = linkedOffer.getcourse_offer_id;
        amountSource = 'subscription_linked_offer';
        console.log(`Subscription ${id}: using linked offer amount = ${amount}`);
      }
    }
    
    // 4. Final fallback: current tariff price (legacy behavior)
    if (!amount || amount <= 0) {
      const { data: priceData } = await supabase
        .from('tariff_prices')
        .select('price, final_price, currency')
        .eq('tariff_id', tariff.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priceData) {
        amount = priceData.final_price || priceData.price;
        currency = priceData.currency || 'BYN';
        amountSource = 'tariff_price_fallback';
        console.log(`Subscription ${id}: using tariff_price fallback = ${amount}`);
      } else {
        // Absolutely final fallback - use tariff original_price
        amount = tariff.original_price || 0;
        currency = 'BYN';
        amountSource = 'tariff_original_price_fallback';
        console.log(`Subscription ${id}: using tariff.original_price fallback = ${amount}`);
      }
    }
  }

  if (!amount || amount <= 0) {
    return { subscription_id: id, success: false, error: 'Invalid charge amount' };
  }

  // Log amount calculation
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

    const chargeAttemptAt = new Date().toISOString();

    // Extract txUid and determine charge success status
    const txUid = chargeResult?.transaction?.uid ?? null;
    const txStatus = (chargeResult?.transaction?.status ?? '').toString().toLowerCase();
    const chargeSucceeded = ['successful', 'succeeded', 'success', 'ok'].includes(txStatus);

    if (chargeResult.transaction?.status === 'successful') {
      // PATCH A: Fix status 'completed' → 'succeeded' + mandatory error handling
      // PATCH A1: Persist meta.bepaid_uid for renewal order creation
      const existingPaymentMeta = (payment?.meta || {}) as Record<string, any>;

      const { data: updatedPayment, error: updatePaymentError } = await supabase
        .from('payments_v2')
        .update({
          status: 'succeeded',  // FIXED: was 'completed' which doesn't exist in enum
          paid_at: new Date().toISOString(),
          provider_payment_id: txUid,
          provider_response: chargeResult,
          card_last4: chargeResult.transaction.credit_card?.last_4 ?? null,
          card_brand: chargeResult.transaction.credit_card?.brand ?? null,
          receipt_url: chargeResult.transaction.receipt_url ?? null,
          meta: {
            ...existingPaymentMeta,
            bepaid_uid: txUid,  // CRITICAL: persist for renewal order idempotency
          },
        })
        .eq('id', payment.id)
        .select('id, status, paid_at, provider_payment_id')
        .single();

      // PATCH A: Log finalize failure if update failed
      if (updatePaymentError) {
        console.error('CRITICAL: Payment finalize failed after successful bePaid charge:', updatePaymentError);
        
        await supabase.from('audit_logs').insert({
          action: 'subscription.charge_finalize_failed',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'subscription-charge',
          target_user_id: user_id,
          meta: {
            subscription_id: id,
            payment_id: payment.id,
            bepaid_uid: chargeResult.transaction.uid,
            amount,
            currency,
            error: updatePaymentError.message,
            error_code: updatePaymentError.code,
            charge_result_status: chargeResult.transaction.status,
          }
        });
        
        // Mark subscription for reconciliation (money was charged, must not lose track)
        await supabase
          .from('subscriptions_v2')
          .update({
            meta: {
              ...(subMeta || {}),
              needs_reconcile: true,
              reconcile_reason: 'payment_finalize_failed',
              failed_payment_id: payment.id,
              failed_bepaid_uid: chargeResult.transaction.uid,
            }
          })
          .eq('id', id);
      }

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

      // Update subscription with new dates
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
            last_charge_attempt_at: chargeAttemptAt,
            last_charge_attempt_kind: 'charge',
            last_charge_attempt_success: true,
            last_charge_attempt_error: null,
            last_charged_at: chargeAttemptAt,
            last_successful_charge_at: chargeAttemptAt,
            // Set reconcile flag on error, clear on success
            needs_reconcile: updatePaymentError ? true : false,
          }
        })
        .eq('id', id);

      // ============= PATCH: CREATE RENEWAL ORDER FOR EACH RECURRING CHARGE =============
      // Purpose: Each successful recurring charge creates a SEPARATE order (deal) in orders_v2
      // This ensures UI shows individual deals per billing cycle, not a single trial order
      let renewalOrderId: string | null = null;
      const bepaidUid = txUid;  // Use txUid extracted earlier from chargeResult
      const pMeta = (payment?.meta || {}) as Record<string, any>;

      // PATCH A2: Use updatedPayment.status OR chargeSucceeded (not stale payment.status)
      // payment.status is 'processing' (before update), updatedPayment.status is 'succeeded'
      const paymentSucceeded = updatedPayment?.status === 'succeeded' || chargeSucceeded;

      // Guard 1: Only for successful charges with positive amount AND valid bepaid_uid
      if (amount > 0 && paymentSucceeded && bepaidUid) {
        // Guard 2: Idempotency - if already created for this payment, skip
        if (!pMeta.renewal_order_id) {
          // Guard 3: Hard idempotency by bePaid uid (avoid duplicates across retries)
          const { data: existingRenewal } = await supabase
            .from('orders_v2')
            .select('id')
            .eq('user_id', user_id)
            .contains('meta', { bepaid_uid: bepaidUid })
            .maybeSingle();

          if (existingRenewal?.id) {
            renewalOrderId = existingRenewal.id;
            console.log(`Renewal order already exists: ${renewalOrderId} for bepaid_uid ${bepaidUid}`);
          } else {
            // Generate order number using DB function
            const { data: ordNum } = await supabase.rpc('generate_order_number');
            const orderNumber = ordNum || `REN-${Date.now().toString(36).toUpperCase()}`;

            // Get profile_id
            const { data: profileRow } = await supabase
              .from('profiles')
              .select('id')
              .eq('user_id', user_id)
              .maybeSingle();

            // Create NEW deal for this renewal
            const { data: newOrder, error: createErr } = await supabase
              .from('orders_v2')
              .insert({
                order_number: orderNumber,
                user_id,
                profile_id: profileRow?.id ?? null,
                status: 'paid',
                currency,
                base_price: amount,
                final_price: amount,
                paid_amount: amount,
                is_trial: false,
                product_id: subscription?.product_id ?? orderData?.product_id ?? null,
                tariff_id: tariff_id ?? orderData?.tariff_id ?? null,
                customer_email: orderData?.customer_email ?? null,
                customer_phone: orderData?.customer_phone ?? null,
                meta: {
                  source: 'subscription-renewal',
                  subscription_id: id,
                  payment_id: payment.id,
                  bepaid_uid: bepaidUid,
                  original_order_id: order_id ?? null,
                  is_trial_conversion: is_trial,
                },
              })
              .select('id, order_number')
              .single();

            if (createErr) {
              console.error('Failed to create renewal order:', createErr);
              await supabase.from('audit_logs').insert({
                action: 'subscription.renewal_order_create_failed',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'subscription-charge',
                target_user_id: user_id,
                meta: {
                  subscription_id: id,
                  payment_id: payment.id,
                  bepaid_uid: bepaidUid,
                  amount,
                  currency,
                  error: createErr.message,
                  error_code: createErr.code,
                },
              });
            } else {
              renewalOrderId = newOrder.id;
              console.log(`Created renewal order ${newOrder.order_number} for subscription ${id}`);

              // Log success (SYSTEM ACTOR)
              await supabase.from('audit_logs').insert({
                action: 'subscription.renewal_order_created',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'subscription-charge',
                target_user_id: user_id,
                meta: {
                  subscription_id: id,
                  payment_id: payment.id,
                  renewal_order_id: renewalOrderId,
                  renewal_order_number: newOrder.order_number,
                  amount,
                  currency,
                  bepaid_uid: bepaidUid,
                },
              });
            }
          }

          // Relink payment to renewal order (if created or found)
          if (renewalOrderId) {
            const { error: linkErr } = await supabase
              .from('payments_v2')
              .update({
                order_id: renewalOrderId,
                meta: {
                  ...pMeta,
                  renewal_order_id: renewalOrderId,
                  original_trial_order_id: order_id ?? null,
                },
              })
              .eq('id', payment.id);

            if (linkErr) {
              console.error('Failed to link payment to renewal order:', linkErr);
              await supabase.from('audit_logs').insert({
                action: 'subscription.renewal_payment_link_failed',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'subscription-charge',
                target_user_id: user_id,
                meta: {
                  subscription_id: id,
                  payment_id: payment.id,
                  renewal_order_id: renewalOrderId,
                  error: linkErr.message,
                  error_code: linkErr.code,
                },
              });
            } else {
              console.log(`Payment ${payment.id} linked to renewal order ${renewalOrderId}`);
            }

            // Update subscription meta with last renewal order
            await supabase
              .from('subscriptions_v2')
              .update({
                meta: {
                  ...(subMeta || {}),
                  last_renewal_order_id: renewalOrderId,
                },
              })
              .eq('id', id);
          }
        }
      } else if (amount > 0 && !bepaidUid) {
        // CONSOLIDATED: Log missing bepaid_uid for any positive-amount payment
        // Covers both paymentSucceeded=true and other cases
        console.warn(`Renewal order skipped for subscription ${id}: missing bepaid_uid (amount=${amount}, paymentSucceeded=${paymentSucceeded})`);
        await supabase.from('audit_logs').insert({
          action: 'subscription.renewal_order_skipped',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'subscription-charge',
          target_user_id: user_id,
          meta: {
            subscription_id: id,
            payment_id: payment?.id,
            reason: 'missing_bepaid_uid',
            amount,
            currency,
            payment_succeeded: paymentSucceeded,
            tx_status: txStatus,
          },
        });
      }
      // ============= END PATCH: CREATE RENEWAL ORDER =============

      // PATCH 1-3: Sync orders_v2 with payments (idempotent, with guards and error handling)
      // IMPORTANT: Skip trial order sync if renewal order was created (each deal is separate)
      if (order_id && !renewalOrderId) {
        // PATCH-2: Use RPC for reliable SQL SUM (instead of JS reduce)
        const { data: expectedPaidResult, error: rpcError } = await supabase
          .rpc('get_order_expected_paid', { p_order_id: order_id });

        if (rpcError) {
          // Log RPC failure (SYSTEM ACTOR)
          console.error('Failed to get expected paid amount via RPC:', rpcError);
          await supabase.from('audit_logs').insert({
            action: 'subscription.order_sync_payments_calc_failed',
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'subscription-charge',
            target_user_id: user_id,
            meta: {
              subscription_id: id,
              order_id,
              payment_id: payment.id,
              error: rpcError.message,
              error_code: rpcError.code,
              method: 'rpc_get_order_expected_paid',
            }
          });
          // Don't proceed with unsafe update - continue to next subscription
        } else {
          const expectedPaidAmount = Number(expectedPaidResult || 0);

          // PATCH-1: Get current order state WITH error handling
          const { data: currentOrder, error: currentOrderError } = await supabase
            .from('orders_v2')
            .select('meta, status, paid_amount')
            .eq('id', order_id)
            .single();

          // PATCH-1: Handle order query failure
          if (currentOrderError) {
            console.error('Failed to fetch current order for sync:', currentOrderError);
            await supabase.from('audit_logs').insert({
              action: 'subscription.order_sync_order_query_failed',
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'subscription-charge',
              target_user_id: user_id,
              meta: {
                subscription_id: id,
                order_id,
                payment_id: payment.id,
                expected_paid_amount: expectedPaidAmount,
                error: currentOrderError.message,
                error_code: currentOrderError.code,
              }
            });
            // Don't proceed with update - unsafe without knowing current state
          } else {
            // PATCH-3: Guard - do NOT update protected statuses (unified list)
            const protectedStatuses = ['refunded', 'canceled', 'cancelled'];
            const isProtected = currentOrder?.status && protectedStatuses.includes(currentOrder.status);

            // FINAL FIX: Only update if NOT protected AND expectedPaidAmount > 0
            // This prevents setting paid status for orders without succeeded payments
            if (!isProtected && expectedPaidAmount > 0) {
              const { error: orderUpdateError } = await supabase
                .from('orders_v2')
                .update({
                  status: 'paid',
                  paid_amount: expectedPaidAmount,
                  meta: {
                    ...(currentOrder?.meta || {}),
                    last_renewal_at: chargeAttemptAt,
                    last_renewal_payment_id: payment.id,
                    last_renewal_amount: amount,
                    last_renewal_bepaid_uid: chargeResult.transaction.uid ?? null,
                  }
                })
                .eq('id', order_id);

              if (orderUpdateError) {
                console.error('Failed to sync order status:', orderUpdateError);
                await supabase.from('audit_logs').insert({
                  action: 'subscription.order_sync_failed',
                  actor_type: 'system',
                  actor_user_id: null,
                  actor_label: 'subscription-charge',
                  target_user_id: user_id,
                  meta: {
                    subscription_id: id,
                    order_id,
                    payment_id: payment.id,
                    expected_paid_amount: expectedPaidAmount,
                    previous_status: currentOrder?.status,
                    previous_paid_amount: currentOrder?.paid_amount,
                    error: orderUpdateError.message,
                  }
                });
              }
            } else {
              console.log(`Skipping order sync: order ${order_id} has protected status ${currentOrder?.status} or no payments`);
            }
          }
        }
      } else if (renewalOrderId) {
        console.log(`Skipping trial order sync: renewal order ${renewalOrderId} was created`);
      }

      // PATCH B: Log successful charge (SYSTEM ACTOR proof)
      await supabase.from('audit_logs').insert({
        action: 'subscription.charged',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'subscription-charge',
        target_user_id: user_id,
        meta: {
          subscription_id: id,
          payment_id: payment.id,
          bepaid_uid: chargeResult.transaction.uid,
          amount,
          currency,
          new_access_end_at: newEndDate.toISOString(),
          new_next_charge_at: nextChargeDate.toISOString(),
          is_trial_conversion: is_trial,
          payment_finalize_success: !updatePaymentError,
          tariff_id: tariff.id,
          order_id: order_id,
        }
      });

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

      // PATCH: Update meta AFTER failed charge attempt
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
                last_charge_attempt_at: chargeAttemptAt,
                last_charge_attempt_kind: 'charge',
                last_charge_attempt_success: false,
                last_charge_attempt_error: errorMsg,
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
                last_charge_attempt_at: chargeAttemptAt,
                last_charge_attempt_kind: 'charge',
                last_charge_attempt_success: false,
                last_charge_attempt_error: errorMsg,
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
              last_charge_attempt_at: chargeAttemptAt,
              last_charge_attempt_kind: 'charge',
              last_charge_attempt_success: false,
              last_charge_attempt_error: errorMsg,
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

    // PATCH: Update meta AFTER exception
    await supabase
      .from('subscriptions_v2')
      .update({
        meta: {
          ...(subMeta || {}),
          last_charge_attempt_at: new Date().toISOString(),
          last_charge_attempt_kind: 'charge',
          last_charge_attempt_success: false,
          last_charge_attempt_error: err instanceof Error ? err.message : 'Unknown error',
        }
      })
      .eq('id', id);

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
    const todayUtc = nowIso.split('T')[0]; // 'YYYY-MM-DD'
    
    // PATCH: End of current day UTC (23:59:59.999Z) for due query
    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);
    const endOfDayIso = endOfDay.toISOString();

    console.log(`Starting subscription charge job... Mode: ${mode}, Source: ${source}, Today UTC: ${todayUtc}`);

    // PATCH 2: DRY-RUN mode - only diagnostics, no charges
    if (mode === 'dry_run') {
      // Get due subscriptions with diagnostic info - use end of day
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
        .lte('next_charge_at', endOfDayIso)
        .in('status', ['active', 'trial', 'past_due'])
        .eq('auto_renew', true)
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
        amount: null,
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

    // ========== EXECUTE mode - actually charge subscriptions ==========
    
    // PATCH: Select ALL candidates due today (with or without card) for accurate statistics
    const { data: allCandidates, error: queryError } = await supabase
      .from('subscriptions_v2')
      .select(`
        *,
        tariffs(id, name, access_days)
      `)
      .lte('next_charge_at', endOfDayIso)  // Use end of day instead of nowIso
      .in('status', ['active', 'trial', 'past_due'])
      .eq('auto_renew', true)
      .lt('charge_attempts', 3)
      .limit(100);

    if (queryError) {
      console.error('Query error:', queryError);
      throw queryError;
    }

    // PATCH: Apply gate - filter out subscriptions already attempted today
    const subscriptionsToProcess = (allCandidates || []).filter(sub => !wasChargeAttemptedToday(sub));
    const skippedAlreadyAttempted = (allCandidates?.length || 0) - subscriptionsToProcess.length;

    // PATCH: Separate with_card and no_card for statistics
    const withCard = subscriptionsToProcess.filter(s => s.payment_method_id);
    const noCard = subscriptionsToProcess.filter(s => !s.payment_method_id);

    console.log(`Found ${allCandidates?.length || 0} total candidates, ${subscriptionsToProcess.length} after gate (skipped ${skippedAlreadyAttempted} already attempted today)`);
    console.log(`With card: ${withCard.length}, No card: ${noCard.length}`);

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

    // PATCH: Add no_card subscriptions to results (don't attempt charge, just record)
    for (const sub of noCard) {
      // Don't update last_charge_attempt_at for no_card - they didn't attempt charge
      results.push({ 
        subscription_id: sub.id, 
        success: false, 
        error: 'No payment method linked',
        skipped: true,
        skip_reason: 'no_card',
      });
      console.log(`Subscription ${sub.id}: skipped (no card)`);
    }

    // PATCH: Charge only subscriptions WITH card
    for (const sub of withCard) {
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
      // Skip if already attempted today
      if (wasChargeAttemptedToday(sub)) {
        console.log(`Trial subscription ${sub.id}: skipped (already attempted today)`);
        continue;
      }
      
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
          skipped: true,
          skip_reason: 'trial_no_autocharge',
        });
      }
    }

    const summary = {
      mode: 'execute',
      source,
      run_at: nowIso,
      total: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success && !r.skipped).length,
      no_card: results.filter(r => r.skip_reason === 'no_card').length,
      results,
    };

    // PATCH: Enhanced SYSTEM ACTOR audit log with new fields
    await supabase.from('audit_logs').insert({
      action: 'subscription.charge_cron_completed',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'subscription-charge',
      meta: {
        source,
        mode,
        run_at: nowIso,
        today_utc: todayUtc,
        // New detailed fields
        total_candidates: allCandidates?.length || 0,
        total_after_gate: subscriptionsToProcess.length,
        skipped_already_attempted_count: skippedAlreadyAttempted,
        charged_attempted_count: withCard.length,
        no_card_count: noCard.length,
        // Results
        success_count: results.filter(r => r.success).length,
        failed_count: results.filter(r => !r.success && !r.skipped).length,
        // Legacy fields for compatibility
        total_processed: results.length,
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
