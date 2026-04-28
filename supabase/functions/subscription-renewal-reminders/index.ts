// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPaymentCheckout } from '../_shared/create-payment-checkout.ts';
import { generateRenewalCTAs, type RenewalCTAs } from '../_shared/generate-renewal-ctas.ts';
import { resolveProductRenewability } from '../_shared/renewal-offer-resolver.ts';
import { greetPrefix, extractFirstName } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PATCH 1-2: Enhanced types with skip/fail separation and error_stage
interface ReminderResult {
  user_id: string;
  subscription_id: string;
  order_id: string | null;
  tariff_id: string | null;
  days_until_expiry: number;
  telegram_sent: boolean;
  telegram_logged: boolean;
  telegram_log_error: string | null;
  email_sent: boolean;
  error?: string;
  reminder_type?: string;
  skip_reason?: 'no_telegram_linked' | 'no_link_bot_configured' | null;
  fail_reason?: 'send_failed' | 'log_insert_failed' | null;
  error_stage?: 'load_profile' | 'send_api' | 'insert_log' | null;
  telegram_api_error?: string | null;
  duplicate_suppressed?: boolean;
}

// Format currency
function formatCurrency(amount: number, currency: string = 'BYN'): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function getDaysWord(days: number): string {
  if (days === 1) return 'день';
  if (days >= 2 && days <= 4) return 'дня';
  return 'дней';
}

/** Escape special chars for Telegram Markdown v1 */
function escapeMd(text: string): string {
  return text.replace(/([*_`\[\]])/g, '\\$1');
}

/**
 * Check if user has an active provider-managed (SBS) subscription for a given product.
 */
async function hasActiveSBS(supabase: any, userId: string, productId: string | null): Promise<boolean> {
  let found = false;

  // Product-scoped SBS check — ТОЛЬКО если productId есть
  if (productId) {
    const { data, error } = await supabase
      .from('provider_subscriptions')
      .select(`
        id, state, subscription_v2_id,
        subscriptions_v2!inner (
          id, tariff_id,
          tariffs!inner ( product_id )
        )
      `)
      .eq('user_id', userId)
      .eq('state', 'active')
      .limit(50);

    if (error) {
      console.error('[reminders] hasActiveSBS query error:', error);
    }

    found = data && data.length > 0 && data.some((ps: any) => {
      const tariffs = ps.subscriptions_v2?.tariffs;
      return tariffs?.product_id === productId;
    });
  }

  if (found) return true;

  // Fallback — БЕЗУСЛОВНЫЙ (работает и при productId=null)
  // При productId=null — целевое поведение: broad check, не слать paylink
  // При productId!=null — defense-in-depth для unlinked subs
  // Guard: next_charge_at >= now() - 1 day, чтобы не блокировать по мусорным записям
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: directPS, error: fallbackError } = await supabase
    .from('provider_subscriptions')
    .select('id, state, next_charge_at')
    .eq('user_id', userId)
    .in('state', ['active', 'past_due', 'failed_attempt'])
    .not('next_charge_at', 'is', null)
    .gte('next_charge_at', oneDayAgo.toISOString())
    .limit(5);

  // STOP-guard: при ошибке fallback query — return true (не слать paylink)
  // Последствие: пользователь НЕ получает напоминание в этом cron-цикле
  if (fallbackError) {
    console.error('[reminders] hasActiveSBS fallback query error:', fallbackError);
    await supabase.from('audit_logs').insert({
      action: 'reminders.sbs_fallback_query_error',
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: { user_id: userId, product_id: productId, error: fallbackError.message },
    });
    return true;
  }

  if (directPS && directPS.length > 0) {
    const auditAction = productId
      ? 'reminders.sbs_fallback_hit'
      : 'reminders.sbs_fallback_hit_no_product';
    console.warn(`[reminders] hasActiveSBS fallback: user ${userId}, action=${auditAction}`);
    await supabase.from('audit_logs').insert({
      action: auditAction,
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: { user_id: userId, product_id: productId, ps_count: directPS.length },
    });
    return true;
  }

  return false;
}

/**
 * PATCH ONE-TIME-CLASSIFIER v1: ID-first detection of one-time products.
 * Returns true ONLY when:
 *  1) tariff_id has at least one active offer, AND
 *  2) NO active offer has offer_type='subscription', AND
 *  3) user has NO active provider_managed subscription for this product.
 * requires_card_tokenization is used as a SECONDARY signal (logged in meta only),
 * never as sole source of truth.
 * Conservative: any error / missing data returns false (treat as recurring).
 */
async function isOneTimeProduct(
  supabase: any,
  tariffId: string | null,
  userId: string,
  productId: string | null,
): Promise<{ oneTime: boolean; signals: Record<string, any> }> {
  // PATCH RENEWAL-RESOLVER v2 (2026-04-28):
  // Source of truth = active tariff_offers of the PRODUCT.
  // A product is "one-time" only when none of its active offers are recurring,
  // installment, or a subscription offer. The user's current sub state is irrelevant
  // for this classification (it is used only for «Подписка уже активна» messaging).
  const signals: Record<string, any> = {
    tariff_id: tariffId,
    product_id: productId,
    resolver: 'renewal-offer-resolver@v1',
  };
  if (!productId) {
    signals.reason = 'no_product_id';
    return { oneTime: false, signals };
  }
  try {
    const r = await resolveProductRenewability(supabase, productId, tariffId);
    signals.renewable = r.renewable;
    signals.has_recurring = r.hasRecurring;
    signals.has_installment = r.hasInstallment;
    signals.has_subscription_offer = r.hasSubscriptionOffer;
    signals.preferred_tariff_id = r.preferredTariffId;
    signals.preferred_kind = r.preferredOffer?.kind ?? null;
    signals.reason = r.reason;
    return { oneTime: !r.renewable, signals };
  } catch (err) {
    console.warn('[one-time-classifier] resolver exception:', err);
    signals.error = err instanceof Error ? err.message : String(err);
    return { oneTime: false, signals };
  }
}

/**
 * PATCH OUTCOME-PARITY v1: Channel-aware idempotency check.
 * Returns true if a SUCCESS outcome already exists for this (subscription, event_type, channel) today.
 * Skip-records (status='skipped') do NOT block re-attempts.
 */
async function hasSuccessOutcomeToday(
  supabase: any,
  channel: 'telegram' | 'email',
  subscriptionId: string,
  eventType: string,
  todayWindow: { start: string; end: string },
): Promise<boolean> {
  try {
    const table = channel === 'telegram' ? 'telegram_logs' : 'email_logs';
    let query = supabase
      .from(table)
      .select('id')
      .eq('status', 'success')
      .gte('created_at', todayWindow.start)
      .lt('created_at', todayWindow.end)
      .limit(1);
    if (channel === 'telegram') {
      query = query.eq('event_type', eventType).eq('action', 'SEND_REMINDER');
    }
    // For email_logs we can only filter by created_at + status; subscription_id lives in meta — filter client-side
    const { data, error } = await query;
    if (error) {
      console.warn(`[idempotency] ${channel} query error:`, error);
      return false;
    }
    if (!data || data.length === 0) return false;
    if (channel === 'telegram') {
      // event_type filter applied; still need subscription_id from meta — re-query targeted
      const { data: targeted } = await supabase
        .from('telegram_logs')
        .select('id, meta')
        .eq('action', 'SEND_REMINDER')
        .eq('event_type', eventType)
        .eq('status', 'success')
        .gte('created_at', todayWindow.start)
        .lt('created_at', todayWindow.end);
      return (targeted || []).some((r: any) => (r.meta as any)?.subscription_id === subscriptionId);
    } else {
      const { data: targeted } = await supabase
        .from('email_logs')
        .select('id, meta')
        .eq('direction', 'outgoing')
        .eq('status', 'sent')
        .gte('created_at', todayWindow.start)
        .lt('created_at', todayWindow.end);
      return (targeted || []).some((r: any) => {
        const m = r.meta as any;
        return m?.subscription_id === subscriptionId && m?.event_type === eventType;
      });
    }
  } catch (err) {
    console.warn(`[idempotency] ${channel} exception:`, err);
    return false;
  }
}

/**
 * PATCH SKIP-LOG v1: Insert canonical skip/fail outcome into telegram_logs.
 */
async function logTelegramSkip(
  supabase: any,
  userId: string,
  subscriptionId: string,
  eventType: string,
  reason: string,
  extraMeta: Record<string, any> = {},
): Promise<void> {
  try {
    await supabase.from('telegram_logs').insert({
      action: 'SEND_REMINDER',
      event_type: eventType,
      user_id: userId,
      status: 'skipped',
      message_text: null,
      error_message: null,
      meta: { reason, subscription_id: subscriptionId, ...extraMeta },
    });
  } catch (err) {
    console.warn('[skip-log] telegram insert failed:', err);
  }
}

/**
 * PATCH SKIP-LOG v1: Insert canonical skip/fail outcome into email_logs.
 */
async function logEmailOutcome(
  supabase: any,
  userId: string,
  profileId: string | null,
  toEmail: string | null,
  subscriptionId: string,
  eventType: string,
  status: 'success' | 'skipped' | 'failed',
  reason: string | null,
  errorMessage: string | null = null,
  extraMeta: Record<string, any> = {},
): Promise<void> {
  try {
    await supabase.from('email_logs').insert({
      user_id: userId,
      profile_id: profileId,
      direction: 'outgoing',
      from_email: 'system',
      to_email: toEmail || 'unknown',
      subject: null,
      status: status === 'success' ? 'sent' : status,
      error_message: errorMessage,
      meta: {
        event_type: eventType,
        subscription_id: subscriptionId,
        reason,
        source: 'subscription-renewal-reminders',
        ...extraMeta,
      },
    });
  } catch (err) {
    console.warn('[email-outcome-log] insert failed:', err);
  }
}

/**
 * Try to generate a payment link for renewal via shared helper.
 * Returns redirect_url or null if generation failed (STOP-guard).
 */
async function tryGeneratePaymentLink(
  supabase: any,
  userId: string,
  productId: string | null,
  tariffId: string | null,
  amount: number, // BYN (not kopecks)
  currency: string,
  billingType?: string | null
): Promise<string | null> {
  // STOP-GUARD: all fields must be present
  if (!productId || !tariffId || !amount || amount <= 0) {
    console.log('[reminders] STOP-GUARD: cannot generate payment link, missing data', {
      has_product_id: !!productId,
      has_tariff_id: !!tariffId,
      amount,
    });
    return null;
  }

  try {
    const amountKopecks = Math.round(amount * 100);
    if (amountKopecks < 100) {
      console.log('[reminders] STOP-GUARD: amount too small for payment link:', amountKopecks);
      return null;
    }

    const result = await createPaymentCheckout({
      supabase,
      user_id: userId,
      product_id: productId,
      tariff_id: tariffId,
      amount: amountKopecks,
      payment_type: billingType === 'provider_managed' ? 'subscription' : 'one_time',
      description: 'Продление подписки',
      origin: 'https://club.gorbova.by',
      actor_type: 'system',
    });

    if (result.success) {
      console.log('[reminders] Payment link generated:', { order_id: result.order_id });
      return result.redirect_url;
    } else {
      console.error('[reminders] Payment link generation failed:', result.error);
      return null;
    }
  } catch (err) {
    console.error('[reminders] Payment link generation error:', err);
    return null;
  }
}

// Send Telegram reminder — PATCH RENEWAL+PAYMENTS.1 B3: 2 buttons for non-SBS
// PATCH ONE-TIME v1: isOneTime=true → info-only text without renewal CTAs
async function sendTelegramReminder(
  supabase: any,
  botToken: string | null,
  userId: string,
  productName: string,
  tariffName: string,
  expiryDate: Date,
  daysLeft: number,
  amount: number,
  currency: string,
  hasSBS: boolean,
  oneTimeUrl: string | null,
  subscriptionUrl: string | null,
  subscriptionId: string,
  orderId: string | null,
  tariffId: string | null,
  productId?: string | null,
  isOneTime: boolean = false,
  botId?: string | null,
): Promise<{ 
  sent: boolean; 
  logged: boolean; 
  logError: string | null;
  skipReason?: 'no_telegram_linked' | 'no_link_bot_configured' | null;
  failReason?: 'send_failed' | 'log_insert_failed' | null;
  errorStage?: 'load_profile' | 'send_api' | 'insert_log' | null;
  telegramApiError?: string | null;
  duplicateSuppressed?: boolean;
}> {
  let sent = false;
  let logged = false;
  let logError: string | null = null;
  let message = '';

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_status, full_name')
      .eq('user_id', userId)
      .single();

    // SKIP - No Telegram linked
    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      const { error: skipLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_REMINDER',
        event_type: `subscription_reminder_${daysLeft}d`,
        user_id: userId,
        status: 'skipped',
        message_text: null,
        error_message: null,
        meta: {
          reason: 'no_telegram_linked',
          message_template_key: `reminder_${daysLeft}d`,
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
        },
      });
      const isDuplicate = skipLogError?.code === '23505';
      return { 
        sent: false, logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_telegram_linked', failReason: null, errorStage: 'load_profile',
        duplicateSuppressed: isDuplicate,
      };
    }

    // SKIP - No bot configured
    if (!botToken) {
      const { error: skipLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_REMINDER',
        event_type: `subscription_reminder_${daysLeft}d`,
        user_id: userId,
        status: 'skipped',
        message_text: null,
        error_message: null,
        meta: {
          reason: 'no_link_bot_configured',
          message_template_key: `reminder_${daysLeft}d`,
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
        },
      });
      const isDuplicate = skipLogError?.code === '23505';
      return { 
        sent: false, logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_link_bot_configured', failReason: null, errorStage: null,
        duplicateSuppressed: isDuplicate,
      };
    }

    // PATCH NAME-V: безопасное обращение через helper. Если имя неопределено —
    // префикс пустой, фраза начинается без обращения (а не с фамилии).
    const safeNamePrefix = escapeMd(greetPrefix(profile));
    // PATCH ONE-TIME v2: точное время Минск (день + месяц + HH:mm)
    const dateFmt = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric', month: 'long', timeZone: 'Europe/Minsk'
    });
    const timeFmt = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Minsk'
    });
    const formattedDate = `${dateFmt.format(expiryDate)} в ${timeFmt.format(expiryDate)} (Минск)`;

    const safeProductName = escapeMd(productName);
    const safeTariffName = escapeMd(tariffName);

    // PATCH ONE-TIME v2: тёплые тексты с эмодзи, точное время, нейтральный CTA (ЛК)
    if (isOneTime) {
      if (daysLeft === 7) {
        message = `📅 *Доступ скоро заканчивается*

${safeNamePrefix}напоминаем: доступ к *${safeProductName}* заканчивается *${formattedDate}*.

Это разовая покупка — продление не требуется. ✅ Спасибо, что были с нами!`;
      } else if (daysLeft === 3) {
        message = `⏰ *Осталось 3 дня доступа*

${safeNamePrefix}доступ к *${safeProductName}* заканчивается *${formattedDate}*.

Это разовая покупка — продление не требуется. ✅`;
      } else if (daysLeft === 1) {
        message = `🔔 *Завтра заканчивается доступ*

${safeNamePrefix}это последнее напоминание: доступ к *${safeProductName}* заканчивается *${formattedDate}*.

Это разовая покупка — продление не требуется. ✅ Благодарим за доверие!`;
      }
    }
    // PATCH RENEWAL+PAYMENTS.1 B3: Unified texts — SBS vs non-SBS (2 buttons)
    else if (daysLeft === 7) {
      if (hasSBS) {
        message = `📅 *Напоминание о подписке*

${safeNamePrefix}ваша подписка на *${safeProductName}* заканчивается через неделю (${formattedDate}).

Автопродление активно — подписка продлится автоматически. Отключить можно в кабинете.`;
      } else {
        message = `📅 *Напоминание о подписке*

${safeNamePrefix}ваша подписка на *${safeProductName}* заканчивается через неделю (${formattedDate}).

📦 *Продукт:* ${safeProductName}
🎯 *Тариф:* ${safeTariffName}

Выберите удобный способ продления:`;
      }
    } else if (daysLeft === 3) {
      if (hasSBS) {
        message = `⏰ *Подписка заканчивается через 3 дня*

${safeNamePrefix}осталось 3 дня до окончания подписки на *${safeProductName}* (${formattedDate}).

Автопродление активно — спишется автоматически. Отключить можно в кабинете.`;
      } else {
        message = `⏰ *Подписка заканчивается через 3 дня*

${safeNamePrefix}осталось 3 дня до окончания подписки на *${safeProductName}* (${formattedDate}).

📦 *${safeProductName}* / ${safeTariffName}

Выберите удобный способ продления:`;
      }
    } else if (daysLeft === 1) {
      if (hasSBS) {
        message = `🔔 *Завтра заканчивается подписка!*

${safeNamePrefix}это последнее напоминание. Подписка продлится автоматически. Отключить можно в кабинете.`;
      } else {
        message = `🔔 *Завтра заканчивается подписка!*

${safeNamePrefix}это последнее напоминание. Подписка на *${safeProductName}* заканчивается ${formattedDate}.

Оплатите сейчас, чтобы сохранить доступ:`;
      }
    }

    if (!message) return { sent: false, logged: false, logError: 'Invalid daysLeft', skipReason: null, failReason: null };

    // PATCH ONE-TIME v1: replyMarkup — one-time gets only "Manage in cabinet" (no paylink CTAs)
    let replyMarkup: any;
    if (isOneTime) {
      replyMarkup = {
        inline_keyboard: [[{ text: '👤 Открыть личный кабинет', url: 'https://club.gorbova.by/purchases' }]],
      };
    } else if (hasSBS) {
      replyMarkup = {
        inline_keyboard: [[{ text: '📋 Управление подпиской', url: 'https://club.gorbova.by/purchases' }]],
      };
    } else {
      const buttons: any[][] = [];
      if (oneTimeUrl) buttons.push([{ text: '💳 Оплатить разово', url: oneTimeUrl }]);
      if (subscriptionUrl) buttons.push([{ text: '🔄 Подписка (автосписание)', url: subscriptionUrl }]);
      if (buttons.length === 0) {
        // Fallback: generic link
        buttons.push([{ text: '💳 Оплатить и продлить', url: 'https://club.gorbova.by/purchases' }]);
      }
      replyMarkup = { inline_keyboard: buttons };
    }

    // Send Telegram message
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      }),
    });

    const result = await response.json();
    sent = result.ok === true;

    // Mirror to admin chat (Contact Center) — only when sendMessage actually succeeded
    if (sent && result?.result?.message_id) {
      await logAutomatedTelegramMessage({
        supabase,
        user_id: userId,
        telegram_user_id: profile.telegram_user_id,
        bot_id: botId ?? null,
        text: message,
        telegram_message_id: result.result.message_id,
        reply_markup: replyMarkup,
        source: 'subscription-renewal-reminders',
        extra_meta: {
          event_type: `subscription_reminder_${daysLeft}d`,
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
        },
      });
    }

    // FAIL - Telegram API error
    if (!sent) {
      const telegramError = result.description || `HTTP ${response.status}`;
      const { error: failLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_REMINDER',
        event_type: `subscription_reminder_${daysLeft}d`,
        user_id: userId,
        status: 'failed',
        error_message: telegramError,
        message_text: message,
        meta: {
          subscription_id: subscriptionId, order_id: orderId, tariff_id: tariffId,
          days_left: daysLeft, has_sbs: hasSBS, has_one_time_url: !!oneTimeUrl, has_subscription_url: !!subscriptionUrl,
          telegram_error_code: result.error_code, telegram_response: result,
          reply_markup: replyMarkup,
          payment_url: oneTimeUrl || subscriptionUrl || null,
        },
      });
      const isDuplicate = failLogError?.code === '23505';
      return {
        sent: false, logged: !failLogError || isDuplicate,
        logError: (failLogError && !isDuplicate) ? failLogError.message : null,
        skipReason: null, failReason: 'send_failed', errorStage: 'send_api',
        telegramApiError: telegramError, duplicateSuppressed: isDuplicate,
      };
    }

    // SUCCESS - Resolve club mapping for structured meta
    let logClubId: string | null = null;
    let logClubName: string | null = null;
    if (productId) {
      try {
        const { data: cm } = await supabase.from('access_rules')
          .select('target_ref').eq('product_id', productId).eq('grant_target_type', 'club').eq('is_active', true).limit(1).maybeSingle();
        if (cm?.target_ref) {
          logClubId = cm.target_ref;
          const { data: cl } = await supabase.from('telegram_clubs')
            .select('club_name').eq('id', cm.target_ref).maybeSingle();
          logClubName = cl?.club_name || null;
        }
      } catch {}
    }

    // SUCCESS - Log
    const { error: insertError } = await supabase.from('telegram_logs').insert({
      action: 'SEND_REMINDER',
      event_type: `subscription_reminder_${daysLeft}d`,
      user_id: userId,
      status: 'success',
      message_text: message,
      meta: {
        days_left: daysLeft, product: productName, tariff: tariffName,
        subscription_id: subscriptionId, order_id: orderId, tariff_id: tariffId,
        has_sbs: hasSBS, has_one_time_url: !!oneTimeUrl, has_subscription_url: !!subscriptionUrl,
        // PATCH-FINAL-v2: full structured notification meta (10-field contract)
        product_id: productId || null,
        product_name: productName,
        club_id: logClubId,
        club_name: logClubName,
        effective_end_at: expiryDate?.toISOString() || null,
        amount: amount || null,
        currency: currency || null,
        pricing_mode: 'regular_renewal',
        source: 'renewal_reminder',
      },
    });
    const isDuplicate = insertError?.code === '23505';
    if (insertError && !isDuplicate) {
      logError = insertError.message;
      console.error('Failed to log telegram reminder:', insertError);
      return { sent: true, logged: false, logError, skipReason: null, failReason: 'log_insert_failed', errorStage: 'insert_log' };
    } else {
      logged = true;
    }

    return { sent, logged, logError: null, skipReason: null, failReason: null, duplicateSuppressed: isDuplicate };
  } catch (err) {
    console.error('Failed to send Telegram reminder:', err);
    return { sent: false, logged: false, logError: err instanceof Error ? err.message : 'Unknown error', skipReason: null, failReason: 'send_failed', errorStage: 'send_api' };
  }
}

// PATCH RENEWAL+PAYMENTS.1 B4: Send email reminder — 2 buttons for non-SBS
// PATCH ONE-TIME v1: isOneTime=true → info-only HTML without renewal CTAs
async function sendEmailReminder(
  supabase: any,
  userId: string,
  profileId: string | null,
  email: string,
  productName: string,
  tariffName: string,
  expiryDate: Date,
  daysLeft: number,
  amount: number,
  currency: string,
  hasSBS: boolean,
  oneTimeUrl: string | null,
  subscriptionUrl: string | null,
  subscriptionId: string,
  orderId: string | null,
  tariffId: string | null,
  isOneTime: boolean = false
): Promise<boolean> {
  try {
    // PATCH ONE-TIME v2: точное время Минск
    const dateFmt = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Minsk'
    });
    const timeFmt = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Minsk'
    });
    const formattedDate = `${dateFmt.format(expiryDate)} в ${timeFmt.format(expiryDate)} (Минск)`;

    let subject = '';
    let bodyHtml = '';

    // PATCH RENEWAL+PAYMENTS.1 B4: Build CTA section — SBS vs 2 buttons
    // PATCH ONE-TIME v2: one-time → нейтральная кнопка «Открыть личный кабинет», без слов «продление»
    let ctaHtml = '';
    if (isOneTime) {
      ctaHtml = `
        <p style="margin-top: 24px;">
          <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            👤 Открыть личный кабинет
          </a>
        </p>`;
    } else if (hasSBS) {
      ctaHtml = `
        <p style="color: #059669; margin: 16px 0;">✅ Автопродление активно. Подписка продлится автоматически. Отключить можно в кабинете.</p>
        <p style="margin-top: 24px;">
          <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            📋 Управление подпиской
          </a>
        </p>`;
    } else {
      const otBtn = oneTimeUrl
        ? `<a href="${oneTimeUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin-right: 12px; margin-bottom: 8px;">💳 Оплатить разово</a>`
        : '';
      const subBtn = subscriptionUrl
        ? `<a href="${subscriptionUrl}" style="display: inline-block; background: #059669; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin-bottom: 8px;">🔄 Подписка (автосписание)</a>`
        : '';
      const fallbackBtn = (!oneTimeUrl && !subscriptionUrl)
        ? `<a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">💳 Оплатить и продлить</a>`
        : '';
      ctaHtml = `
        <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0; color: #0c4a6e;">Выберите удобный способ продления:</p>
        </div>
        <p style="margin-top: 24px;">${otBtn}${subBtn}${fallbackBtn}</p>`;
    }

    const statusSection = ctaHtml;

    // PATCH ONE-TIME v2: отдельные subject/body для разовых продуктов (без слова «подписка»)
    if (isOneTime) {
      const headerByDays: Record<number, { subject: string; title: string; lead: string; tone: 'normal' | 'warn' }> = {
        7:  { subject: `📅 Доступ к ${productName} скоро заканчивается`, title: 'Доступ скоро заканчивается', lead: 'Напоминаем: ваш доступ заканчивается через <strong>7 дней</strong>.', tone: 'normal' },
        3:  { subject: `⏰ ${productName}: 3 дня до окончания доступа`, title: 'Осталось 3 дня', lead: 'До окончания вашего доступа осталось <strong>3 дня</strong>.', tone: 'normal' },
        1:  { subject: `🔔 Завтра заканчивается доступ к ${productName}`, title: 'Завтра заканчивается доступ', lead: 'Ваш доступ заканчивается <strong>завтра</strong>.', tone: 'warn' },
      };
      const cfg = headerByDays[daysLeft];
      if (cfg) {
        subject = cfg.subject;
        const cardBg = cfg.tone === 'warn' ? '#fef2f2' : '#f3f4f6';
        const cardBorder = cfg.tone === 'warn' ? '1px solid #fecaca' : 'none';
        const titleColor = cfg.tone === 'warn' ? '#dc2626' : '#1f2937';
        bodyHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: ${titleColor}; font-size: 24px; margin-bottom: 20px;">${cfg.title}</h1>
            <p>Здравствуйте!</p>
            <p>${cfg.lead}</p>
            <div style="background: ${cardBg}; border: ${cardBorder}; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
              <p style="margin: 0;"><strong>📆 Доступ до:</strong> ${formattedDate}</p>
            </div>
            <p style="color: #4b5563; margin: 16px 0;">Это разовая покупка — продление не требуется. ✅ Спасибо, что были с нами!</p>
            ${statusSection}
            <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">С уважением,<br>Команда клуба</p>
          </div>`;
      }
    } else if (daysLeft === 7) {
      subject = '📅 Напоминание: подписка заканчивается через неделю';
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px;">Напоминание о подписке</h1>
          <p>Здравствуйте!</p>
          <p>Ваша подписка заканчивается через <strong>7 дней</strong>.</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
            <p style="margin: 0 0 8px 0;"><strong>🎯 Тариф:</strong> ${tariffName}</p>
            <p style="margin: 0;"><strong>📆 Дата окончания:</strong> ${formattedDate}</p>
          </div>
          ${statusSection}
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">С уважением,<br>Команда клуба</p>
        </div>`;
    } else if (daysLeft === 3) {
      subject = '⏰ Подписка заканчивается через 3 дня';
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px;">Осталось 3 дня</h1>
          <p>Здравствуйте!</p>
          <p>До окончания вашей подписки осталось <strong>3 дня</strong>.</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
            <p style="margin: 0 0 8px 0;"><strong>🎯 Тариф:</strong> ${tariffName}</p>
            <p style="margin: 0;"><strong>📆 Дата окончания:</strong> ${formattedDate}</p>
          </div>
          ${statusSection}
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">С уважением,<br>Команда клуба</p>
        </div>`;
    } else if (daysLeft === 1) {
      subject = '🔔 Завтра заканчивается подписка!';
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #dc2626; font-size: 24px; margin-bottom: 20px;">Последнее напоминание!</h1>
          <p>Здравствуйте!</p>
          <p>Ваша подписка заканчивается <strong>завтра</strong>.</p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
            <p style="margin: 0 0 8px 0;"><strong>🎯 Тариф:</strong> ${tariffName}</p>
            <p style="margin: 0;"><strong>📆 Дата окончания:</strong> ${formattedDate}</p>
          </div>
          ${statusSection}
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">С уважением,<br>Команда клуба</p>
        </div>`;
    }

    if (!subject) return false;

    const eventType = `subscription_reminder_${daysLeft}d`;
    
    const emailPayload = {
      to: email,
      subject,
      html: bodyHtml,
      context: {
        user_id: userId,
        profile_id: profileId,
        subscription_id: subscriptionId,
        event_type: eventType,
        meta: {
          days_left: daysLeft,
          has_sbs: hasSBS,
          has_one_time_url: !!oneTimeUrl,
          has_subscription_url: !!subscriptionUrl,
          source: 'subscription-renewal-reminders',
          order_id: orderId,
          tariff_id: tariffId,
        }
      }
    };
    
    console.log('[reminders] send-email payload:', JSON.stringify({
      to: email,
      'context.user_id': userId,
      'context.profile_id': profileId,
      'context.subscription_id': subscriptionId,
      'context.event_type': eventType,
    }));

    const { error } = await supabase.functions.invoke('send-email', {
      body: emailPayload,
    });

    if (error) {
      console.error('Email send error:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Failed to send email reminder:', err);
    return false;
  }
}

// F10: Check if reminder was already sent today (APP_TZ day window)
async function wasReminderSentToday(
  supabase: any,
  userId: string,
  eventType: string,
  todayWindow: { start: string; end: string }
): Promise<boolean> {
  const { data } = await supabase
    .from('telegram_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('created_at', todayWindow.start)
    .lt('created_at', todayWindow.end)
    .limit(1);

  return (data?.length || 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const source = body.source || 'manual';

    // === DEBUG MODE: orphan DoD single-user test ===
    if (body.debug_mode === true) {
      const debugUserId = String(body.debug_user_id || '').trim();
      const debugDryRun = body.debug_dry_run;
      const debugDaysLeft = body.debug_days_left ?? 3;
      const debugProductId = body.debug_product_id ?? null;
      const debugSubscriptionId = body.debug_subscription_id ?? null;
      const executionId = req.headers.get('x-deno-execution-id') || crypto.randomUUID();

      // STOP-guards
      if (source !== 'manual_orphan_dod') {
        return new Response(JSON.stringify({ error: 'debug_mode requires source="manual_orphan_dod"' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Auth guard: require CRON_SECRET (or DEBUG_SECRET) header
      const debugSecret = req.headers.get('x-debug-secret') || req.headers.get('x-cron-secret');
      const expectedSecret = Deno.env.get('CRON_SECRET') || Deno.env.get('DEBUG_SECRET');
      if (!expectedSecret || debugSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: 'unauthorized: invalid or missing debug secret' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!debugUserId) {
        return new Response(JSON.stringify({ error: 'debug_user_id required (UUID string)' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(debugUserId)) {
        return new Response(JSON.stringify({ error: 'debug_user_id must be valid UUID' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (debugDryRun !== true) {
        return new Response(JSON.stringify({ error: 'debug_dry_run must be true for DoD' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // --- Console log for Lovable Cloud Logs visibility (Block A proof) ---
      console.log('[DEBUG-DOD] Invoke accepted:', JSON.stringify({
        execution_id: executionId,
        source,
        debug_user_id: debugUserId,
        debug_subscription_id: debugSubscriptionId,
        debug_dry_run: debugDryRun,
        timestamp: new Date().toISOString(),
      }));

      const baseMeta = {
        user_id: debugUserId,
        product_id: debugProductId,
        provider_subscription_id: debugSubscriptionId,
        days_left: debugDaysLeft,
        execution_id: executionId,
        source,
        debug: true,
        ttl_hint: 'debug',
      };

      // Audit: started
      await supabase.from('audit_logs').insert({
        action: 'reminders.orphan_dod_started',
        actor_type: 'system',
        actor_label: 'subscription-renewal-reminders',
        meta: baseMeta,
      });

      // Diagnostic: count orphan provider_subscriptions for this user
      const oneDayAgoDebug = new Date();
      oneDayAgoDebug.setDate(oneDayAgoDebug.getDate() - 1);
      const { data: orphanPS } = await supabase
        .from('provider_subscriptions')
        .select('id, state, subscription_v2_id, next_charge_at')
        .eq('user_id', debugUserId)
        .in('state', ['active', 'past_due', 'failed_attempt'])
        .is('subscription_v2_id', null)
        .not('next_charge_at', 'is', null)
        .gte('next_charge_at', oneDayAgoDebug.toISOString())
        .limit(10);
      const orphanPsCount = orphanPS?.length ?? 0;

      // Core test
      const userHasSBS = await hasActiveSBS(supabase, debugUserId, debugProductId);

      // Determine "via" — re-check to see which path triggered
      let via = 'unknown';
      if (userHasSBS) {
        // Check if product-scoped join found it
        if (debugProductId) {
          const { data: joinCheck } = await supabase
            .from('provider_subscriptions')
            .select('id, subscriptions_v2!inner ( tariffs!inner ( product_id ) )')
            .eq('user_id', debugUserId)
            .eq('state', 'active')
            .limit(5);
          const joinHit = joinCheck?.some((ps: any) => ps.subscriptions_v2?.tariffs?.product_id === debugProductId);
          via = joinHit ? 'join' : 'fallback';
        } else {
          via = orphanPsCount > 0 ? 'fallback' : 'fallback_linked';
        }

        await supabase.from('audit_logs').insert({
          action: 'reminders.orphan_dod_has_sbs_true',
          actor_type: 'system',
          actor_label: 'subscription-renewal-reminders',
          meta: { ...baseMeta, via, orphan_ps_count: orphanPsCount },
        });

        // Debug-only suppression (NOT production action)
        await supabase.from('audit_logs').insert({
          action: 'reminders.orphan_dod_suppressed_sbs',
          actor_type: 'system',
          actor_label: 'subscription-renewal-reminders',
          meta: { ...baseMeta, via, orphan_ps_count: orphanPsCount },
        });
      } else {
        // FAIL signal
        await supabase.from('audit_logs').insert({
          action: 'reminders.orphan_dod_has_sbs_false',
          actor_type: 'system',
          actor_label: 'subscription-renewal-reminders',
          meta: { ...baseMeta, orphan_ps_count: orphanPsCount },
        });
      }

      // Audit: completed
      await supabase.from('audit_logs').insert({
        action: 'reminders.orphan_dod_completed',
        actor_type: 'system',
        actor_label: 'subscription-renewal-reminders',
        meta: { ...baseMeta, has_sbs: userHasSBS, via, dry_run: true, orphan_ps_count: orphanPsCount },
      });

      // --- Console log for Lovable Cloud Logs visibility (Block A proof) ---
      console.log('[DEBUG-DOD] Completed:', JSON.stringify({
        execution_id: executionId,
        has_sbs: userHasSBS,
        via,
        orphan_ps_count: orphanPsCount,
        timestamp: new Date().toISOString(),
      }));

      return new Response(JSON.stringify({
        ok: true, mode: 'debug', userHasSBS, via, dryRun: true, orphanPsCount: orphanPsCount, executionId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // === END DEBUG MODE ===

    console.log(`Starting subscription renewal reminders job... Source: ${source}`);

    const now = new Date();
    const results: ReminderResult[] = [];

    // Load link bot ONCE at start of run
    const { data: linkBot, error: botError } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, bot_name, status, is_primary, bot_token_encrypted')
      .eq('is_primary', true)
      .eq('status', 'active')
      .limit(1)
      .single();

    const botToken = linkBot?.bot_token_encrypted ?? null;
    const linkBotMissing = !botToken;

    console.log(`Link bot status: ${linkBotMissing ? 'NOT FOUND' : `@${linkBot?.bot_username}`}`);

    if (linkBotMissing) {
      await supabase.from('audit_logs').insert({
        action: 'telegram.bot_config_missing',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'subscription-renewal-reminders',
        meta: {
          run_at: now.toISOString(), source,
          query: 'is_primary=true AND status=active',
          hint: 'Check telegram_bots table: need is_primary=true AND status=active',
          bot_error: botError?.message || null,
        },
      });
    }

    // F10: Import timezone helpers
    const { APP_TZ, todayDateKey, addDaysToDateKey, dayWindowUtc, toTzDateKey } = await import('../_shared/timezone.ts');
    const todayKey = todayDateKey(APP_TZ);
    const todayWindow = dayWindowUtc(APP_TZ, todayKey);
    console.log(`[F10] APP_TZ=${APP_TZ}, todayKey=${todayKey}, todayWindow=${todayWindow.start}..${todayWindow.end}`);

    // ============ STANDARD REMINDERS (7, 3, 1 days by access_end_at) ============
    for (const daysLeft of [7, 3, 1]) {
      const targetDateKey = addDaysToDateKey(todayKey, daysLeft);
      const { start: windowStart, end: windowEnd } = dayWindowUtc(APP_TZ, targetDateKey);

      console.log(`Checking subscriptions expiring in ${daysLeft} days (dateKey=${targetDateKey}, window=${windowStart}..${windowEnd})`);

      const { data: subscriptions, error } = await supabase
        .from('subscriptions_v2')
        .select(`
          id,
          user_id,
          order_id,
          access_end_at,
          payment_token,
          tariff_id,
          billing_type,
          payment_method_id,
          tariffs (
            id,
            name,
            product_id,
            products_v2 (
              id,
              name
            )
          )
        `)
        .in('status', ['active', 'trial'])
        .gte('access_end_at', windowStart)
        .lt('access_end_at', windowEnd);
        // PATCH PAYMENTS+REMINDERS v3 B-S1: убран фильтр .eq('auto_renew', true).
        // Когорта расширена: теперь напоминания получают и пользователи с auto_renew=false.
        // Текстовая ветка различается ниже через hasActiveSBS / generateRenewalCTAs.

      if (error) {
        console.error(`Query error for ${daysLeft} days:`, error);
        continue;
      }

      console.log(`[v3 B-S1] Found ${subscriptions?.length || 0} subscriptions expiring in ${daysLeft} days (cohort expanded: includes auto_renew=false)`);

      for (const sub of subscriptions || []) {
        const userId = sub.user_id;

        // Anti-stale guard: re-read subscription by ID before sending
        const { data: freshSub } = await supabase
          .from('subscriptions_v2')
          .select('id, access_end_at, status')
          .eq('id', sub.id)
          .maybeSingle();

        const eventType = `subscription_reminder_${daysLeft}d`;

        if (freshSub && (freshSub.status !== sub.status || new Date(freshSub.access_end_at) > new Date(windowEnd))) {
          console.log(`[anti-stale] Subscription ${sub.id} changed (status=${freshSub.status}, access_end_at=${freshSub.access_end_at}), skipping reminder`);
          // PATCH SKIP-LOG v1: log skip outcome (TG only — email skip logged later when needed)
          await logTelegramSkip(supabase, userId, sub.id, eventType, 'subscription_changed', {
            days_left: daysLeft, fresh_status: freshSub.status, fresh_access_end_at: freshSub.access_end_at,
          });
          continue;
        }

        // PATCH OUTCOME-PARITY v1: separate TG/Email locks (channel-aware)
        const tgAlreadySuccess = await hasSuccessOutcomeToday(supabase, 'telegram', sub.id, eventType, todayWindow);
        const emailAlreadySuccess = await hasSuccessOutcomeToday(supabase, 'email', sub.id, eventType, todayWindow);

        // Get user profile and email
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('user_id', userId)
          .single();

        let userEmail = profile?.email;
        if (!userEmail) {
          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          userEmail = authUser?.user?.email;
        }

        // Get tariff price
        let amount = 0;
        let currency = 'BYN';
        if (sub.tariff_id) {
          const { data: priceData } = await supabase
            .from('tariff_prices')
            .select('final_price, price, currency')
            .eq('tariff_id', sub.tariff_id)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (priceData) {
            amount = priceData.final_price || priceData.price || 0;
            currency = priceData.currency || 'BYN';
          }
        }

        const tariff = sub.tariffs as any;
        const product = tariff?.products_v2 as any;
        const productId = product?.id || tariff?.product_id || null;
        const productName = product?.name || 'Подписка';
        const tariffName = tariff?.name || 'Стандартный';
        const expiryDate = new Date(sub.access_end_at);

        // PATCH ONE-TIME v1: classify product (ID-first)
        const classify = await isOneTimeProduct(supabase, sub.tariff_id, userId, productId);
        const productIsOneTime = classify.oneTime;
        if (productIsOneTime) {
          await supabase.from('audit_logs').insert({
            action: 'reminders.one_time_product_detected',
            actor_type: 'system',
            actor_label: 'subscription-renewal-reminders',
            meta: {
              user_id: userId, product_id: productId, subscription_id: sub.id,
              tariff_id: sub.tariff_id, days_left: daysLeft, signals: classify.signals,
            },
          });
        }

        // Check if user has active SBS for this product
        const userHasSBS = await hasActiveSBS(supabase, userId, productId);

        // PATCH RENEWAL+PAYMENTS.1 B5: Generate 2 CTA links for non-SBS, non-one-time
        let oneTimeUrl: string | null = null;
        let subscriptionUrl: string | null = null;
        if (!productIsOneTime && !userHasSBS && productId && sub.tariff_id && amount > 0) {
          const ctas = await generateRenewalCTAs({
            supabase, userId, productId, tariffId: sub.tariff_id,
            amount, currency, actorType: 'system',
          });
          oneTimeUrl = ctas.oneTimeUrl;
          subscriptionUrl = ctas.subscriptionUrl;

          if (oneTimeUrl || subscriptionUrl) {
            await supabase.from('audit_logs').insert({
              action: 'reminders.paylink_cta_generated',
              actor_type: 'system',
              actor_label: 'subscription-renewal-reminders',
              meta: {
                user_id: userId, product_id: productId, subscription_id: sub.id,
                days_left: daysLeft, has_one_time: !!oneTimeUrl, has_subscription: !!subscriptionUrl,
              },
            });
          }
        } else if (userHasSBS && !productIsOneTime) {
          await supabase.from('audit_logs').insert({
            action: 'reminders.paylink_cta_suppressed_sbs',
            actor_type: 'system',
            actor_label: 'subscription-renewal-reminders',
            meta: { user_id: userId, product_id: productId, subscription_id: sub.id },
          });
        }

        const result: ReminderResult = {
          user_id: userId,
          subscription_id: sub.id,
          order_id: sub.order_id,
          tariff_id: sub.tariff_id,
          days_until_expiry: daysLeft,
          telegram_sent: false,
          telegram_logged: false,
          telegram_log_error: null,
          email_sent: false,
          reminder_type: 'expiry_reminder',
        };

        // ===== TELEGRAM channel =====
        if (tgAlreadySuccess) {
          console.log(`[idempotency-tg] Subscription ${sub.id} already has TG success today, skipping TG attempt`);
          // No additional skip-record (success already covers UI indicator)
          result.telegram_sent = true;
          result.telegram_logged = true;
        } else {
          const telegramResult = await sendTelegramReminder(
            supabase, botToken, userId,
            productName, tariffName, expiryDate, daysLeft,
            amount, currency, userHasSBS, oneTimeUrl, subscriptionUrl,
            sub.id, sub.order_id, sub.tariff_id, productId, productIsOneTime,
            linkBot?.id ?? null,
          );
          result.telegram_sent = telegramResult.sent;
          result.telegram_logged = telegramResult.logged;
          result.telegram_log_error = telegramResult.logError;
          result.skip_reason = telegramResult.skipReason;
          result.fail_reason = telegramResult.failReason;
          result.error_stage = telegramResult.errorStage;
          result.telegram_api_error = telegramResult.telegramApiError;
          result.duplicate_suppressed = telegramResult.duplicateSuppressed;
        }

        // ===== EMAIL channel (independent of TG) =====
        if (emailAlreadySuccess) {
          console.log(`[idempotency-email] Subscription ${sub.id} already has Email success today, skipping Email attempt`);
          result.email_sent = true;
        } else if (!userEmail) {
          // PATCH SKIP-LOG v1: write canonical email_missing skip-record
          await logEmailOutcome(
            supabase, userId, profile?.id || null, null, sub.id, eventType,
            'skipped', 'email_missing', null,
            { days_left: daysLeft, product_id: productId, is_one_time: productIsOneTime },
          );
        } else {
          try {
            const emailOk = await sendEmailReminder(
              supabase, userId, profile?.id || null, userEmail,
              productName, tariffName, expiryDate, daysLeft,
              amount, currency, userHasSBS, oneTimeUrl, subscriptionUrl,
              sub.id, sub.order_id, sub.tariff_id, productIsOneTime
            );
            // PATCH OUTCOME-PARITY v1: write canonical email outcome.
            // send-email writes its OWN row with status='sent' on actual SMTP accept.
            // We write a parallel "queued" row so UI shows green even if send-email log race-loses.
            // Note: status='success' here means "invoke returned ok, queued for delivery"
            if (emailOk) {
              await logEmailOutcome(
                supabase, userId, profile?.id || null, userEmail, sub.id, eventType,
                'success', 'email_queued', null,
                { days_left: daysLeft, product_id: productId, is_one_time: productIsOneTime },
              );
              result.email_sent = true;
            } else {
              await logEmailOutcome(
                supabase, userId, profile?.id || null, userEmail, sub.id, eventType,
                'failed', 'send_failed', 'send-email invoke returned false',
                { days_left: daysLeft, product_id: productId, is_one_time: productIsOneTime },
              );
            }
          } catch (emailErr) {
            await logEmailOutcome(
              supabase, userId, profile?.id || null, userEmail, sub.id, eventType,
              'failed', 'send_failed', emailErr instanceof Error ? emailErr.message : 'unknown',
              { days_left: daysLeft, product_id: productId, is_one_time: productIsOneTime },
            );
          }
        }

        results.push(result);
        console.log(`Processed reminder for user ${userId}: TG sent=${result.telegram_sent}, SBS=${userHasSBS}, oneTime=${productIsOneTime}, paylink_oneTime=${!!oneTimeUrl}, paylink_sub=${!!subscriptionUrl}, Email=${result.email_sent}`);
      }
    }

    // ============ EXPIRING WITHOUT SBS (replaces old NO-CARD WARNING) ============
    // Instead of warning about missing cards, we now check for missing SBS and send payment links
    console.log('Checking for expiring subscriptions without SBS...');
    
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const { data: expiringSubs } = await supabase
      .from('subscriptions_v2')
      .select(`
        id,
        user_id,
        order_id,
        access_end_at,
        tariff_id,
        billing_type,
        tariffs (
          id,
          name,
          product_id,
          products_v2 (id, name)
        )
      `)
      // PATCH PAYMENTS+REMINDERS v3 B-S1: убран фильтр .eq('auto_renew', true).
      // Логика "expiring without SBS" уже базируется на hasActiveSBS (ниже), фильтр auto_renew был лишним:
      // он отрезал именно тех, у кого автопродления нет, — кому напоминание нужно больше всего.
      .in('status', ['active', 'trial'])
      .lte('access_end_at', sevenDaysFromNow.toISOString())
      .gte('access_end_at', now.toISOString())
      .limit(100);

    console.log(`[v3 B-S1] Found ${expiringSubs?.length || 0} subscriptions expiring within 7 days for SBS check (cohort expanded)`);

    for (const sub of expiringSubs || []) {
      const userId = sub.user_id;

      const tariff = sub.tariffs as any;
      const product = tariff?.products_v2 as any;
      const productId = product?.id || tariff?.product_id || null;
      const productName = product?.name || tariff?.name || 'Подписка';

      const accessEndAt = new Date(sub.access_end_at);
      const daysLeft = Math.ceil((accessEndAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const noCardReminderDays = [7, 3, 1];
      if (!noCardReminderDays.includes(daysLeft)) continue;

      const eventType = `subscription_reminder_${daysLeft}d`;

      // PATCH OUTCOME-PARITY v1: skip second-block if main loop already produced TG outcome today
      if (await hasSuccessOutcomeToday(supabase, 'telegram', sub.id, eventType, todayWindow)) {
        console.log(`[second-block] Subscription ${sub.id} already has TG success today, skipping duplicate`);
        continue;
      }

      // Legacy lock kept for backward compat
      if (await wasReminderSentToday(supabase, userId, 'subscription_no_card_warning', todayWindow)) {
        continue;
      }

      // PATCH ONE-TIME v1: classify in second block too
      const classify = await isOneTimeProduct(supabase, sub.tariff_id, userId, productId);
      const productIsOneTime = classify.oneTime;

      // Only send if user does NOT have active SBS
      const userHasSBS = await hasActiveSBS(supabase, userId, productId);
      if (userHasSBS && !productIsOneTime) {
        console.log(`User ${userId} has active SBS, skipping expiring-without-SBS warning`);
        await supabase.from('audit_logs').insert({
          action: 'reminders.paylink_cta_suppressed_sbs',
          actor_type: 'system',
          actor_label: 'subscription-renewal-reminders',
          meta: { user_id: userId, product_id: productId, subscription_id: sub.id },
        });
        // PATCH SKIP-LOG v1: write canonical skip outcome (so UI shows green for SBS users)
        await logTelegramSkip(supabase, userId, sub.id, eventType, 'active_sbs_provider_will_charge', {
          days_left: daysLeft, source_block: 'expiring_without_sbs',
        });
        continue;
      }

      // Get tariff price for payment link
      let amount = 0;
      let currency = 'BYN';
      if (sub.tariff_id) {
        const { data: priceData } = await supabase
          .from('tariff_prices')
          .select('final_price, price, currency')
          .eq('tariff_id', sub.tariff_id)
          .eq('is_active', true)
          .limit(1)
          .single();
        if (priceData) {
          amount = priceData.final_price || priceData.price || 0;
          currency = priceData.currency || 'BYN';
        }
      }

      // PATCH RENEWAL+PAYMENTS.1 B5: Generate 2 CTA links — only for recurring products
      let ncOneTimeUrl: string | null = null;
      let ncSubscriptionUrl: string | null = null;
      if (!productIsOneTime && productId && sub.tariff_id && amount > 0) {
        const ctas = await generateRenewalCTAs({
          supabase, userId, productId, tariffId: sub.tariff_id,
          amount, currency, actorType: 'system',
        });
        ncOneTimeUrl = ctas.oneTimeUrl;
        ncSubscriptionUrl = ctas.subscriptionUrl;

        if (ncOneTimeUrl || ncSubscriptionUrl) {
          await supabase.from('audit_logs').insert({
            action: 'reminders.paylink_cta_generated',
            actor_type: 'system',
            actor_label: 'subscription-renewal-reminders',
            meta: {
              user_id: userId, product_id: productId, subscription_id: sub.id,
              days_left: daysLeft, has_one_time: !!ncOneTimeUrl, has_subscription: !!ncSubscriptionUrl,
              source_block: 'expiring_without_sbs',
            },
          });
        }
      }

      // Send via the unified sendTelegramReminder (with hasSBS=false, isOneTime from classify)
      const telegramResult = await sendTelegramReminder(
        supabase, botToken, userId,
        productName, tariff?.name || 'Стандартный',
        accessEndAt, daysLeft, amount, currency,
        false, ncOneTimeUrl, ncSubscriptionUrl,
        sub.id, sub.order_id, sub.tariff_id, productId, productIsOneTime,
        linkBot?.id ?? null,
      );

      results.push({
        user_id: userId,
        subscription_id: sub.id,
        order_id: sub.order_id,
        tariff_id: sub.tariff_id,
        days_until_expiry: daysLeft,
        telegram_sent: telegramResult.sent,
        telegram_logged: telegramResult.logged,
        telegram_log_error: telegramResult.logError,
        email_sent: false,
        reminder_type: 'no_card_warning', // keep for backward compat in stats
        skip_reason: telegramResult.skipReason,
        fail_reason: telegramResult.failReason,
        error_stage: telegramResult.errorStage,
        telegram_api_error: telegramResult.telegramApiError,
        duplicate_suppressed: telegramResult.duplicateSuppressed,
      });

      console.log(`Expiring-without-SBS for user ${userId}: sent=${telegramResult.sent}, oneTime=${!!ncOneTimeUrl}, sub=${!!ncSubscriptionUrl}`);
    }

    // ============ Statistics ============
    const reminders7d = results.filter(r => r.days_until_expiry === 7 && r.reminder_type === 'expiry_reminder');
    const reminders3d = results.filter(r => r.days_until_expiry === 3 && r.reminder_type === 'expiry_reminder');
    const reminders1d = results.filter(r => r.days_until_expiry === 1 && r.reminder_type === 'expiry_reminder');
    const noCardWarnings = results.filter(r => r.reminder_type === 'no_card_warning');

    const skippedNoTelegram = results.filter(r => r.skip_reason === 'no_telegram_linked');
    const skippedNoBot = results.filter(r => r.skip_reason === 'no_link_bot_configured');
    const failedSend = results.filter(r => r.fail_reason === 'send_failed');
    const failedLogInsert = results.filter(r => r.fail_reason === 'log_insert_failed');
    const duplicateSuppressed = results.filter(r => r.duplicate_suppressed);

    const summary = {
      source,
      run_at: now.toISOString(),
      link_bot_available: !linkBotMissing,
      total: results.length,
      expiry_reminders: results.filter(r => r.reminder_type === 'expiry_reminder').length,
      no_card_warnings: noCardWarnings.length,
      telegram_sent: results.filter(r => r.telegram_sent).length,
      telegram_logged: results.filter(r => r.telegram_logged).length,
      telegram_log_failed: results.filter(r => r.telegram_log_error).length,
      email_sent: results.filter(r => r.email_sent).length,
      skipped_no_telegram_linked: skippedNoTelegram.length,
      skipped_no_link_bot: skippedNoBot.length,
      failed_send: failedSend.length,
      failed_log_insert: failedLogInsert.length,
      duplicate_suppressed: duplicateSuppressed.length,
    };

    await supabase.from('audit_logs').insert({
      action: 'subscription.reminders_cron_completed',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'subscription-renewal-reminders',
      meta: {
        source,
        run_at: now.toISOString(),
        link_bot_available: !linkBotMissing,
        total_processed: results.length,
        reminders_7d_sent: reminders7d.filter(r => r.telegram_sent).length,
        reminders_3d_sent: reminders3d.filter(r => r.telegram_sent).length,
        reminders_1d_sent: reminders1d.filter(r => r.telegram_sent).length,
        no_card_warnings_sent: noCardWarnings.filter(r => r.telegram_sent).length,
        expiry_reminders_sent: results.filter(r => r.reminder_type === 'expiry_reminder' && r.telegram_sent).length,
        telegram_sent_count: results.filter(r => r.telegram_sent).length,
        telegram_logged_count: results.filter(r => r.telegram_logged).length,
        skipped_no_telegram_linked_count: skippedNoTelegram.length,
        skipped_no_link_bot_count: skippedNoBot.length,
        failed_send_count: failedSend.length,
        failed_log_insert_count: failedLogInsert.length,
        duplicate_suppressed_count: duplicateSuppressed.length,
        skip_samples: [...skippedNoTelegram, ...skippedNoBot]
          .slice(0, 10)
          .map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id, reason: r.skip_reason })),
        fail_samples: [...failedSend, ...failedLogInsert]
          .slice(0, 20)
          .map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id, reason: r.fail_reason, stage: r.error_stage, error: r.telegram_api_error || r.telegram_log_error })),
        duplicate_samples: duplicateSuppressed.length > 0 
          ? duplicateSuppressed.slice(0, 10).map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id }))
          : undefined,
        recipients_7d: reminders7d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id })),
        recipients_3d: reminders3d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id })),
        recipients_1d: reminders1d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id })),
        no_card_recipients: noCardWarnings.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ user_id: r.user_id, subscription_id: r.subscription_id })),
      }
    });

    // F10 P7: Timezone audit log + self-check for 23:00 UTC edge cases
    await supabase.from('audit_logs').insert({
      action: 'subscription.reminders_timezone_check',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'F10_timezone',
      meta: {
        app_tz: APP_TZ,
        today_key: todayKey,
        today_window_utc: todayWindow,
        reminder_windows: [7, 3, 1].map(d => {
          const dk = addDaysToDateKey(todayKey, d);
          return { days: d, date_key: dk, ...dayWindowUtc(APP_TZ, dk) };
        }),
        total_reminders_sent: results.filter(r => r.telegram_sent).length,
      }
    });

    console.log('Subscription renewal reminders job completed:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Subscription renewal reminders error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
