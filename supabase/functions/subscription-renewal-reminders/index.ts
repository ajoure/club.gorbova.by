import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  // PATCH: Skip vs Fail distinction
  skip_reason?: 'no_telegram_linked' | 'no_link_bot_configured' | null;
  fail_reason?: 'send_failed' | 'log_insert_failed' | null;
  error_stage?: 'load_profile' | 'send_api' | 'insert_log' | null;
  telegram_api_error?: string | null;
  // PATCH 5: Duplicate suppression tracking
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

// PATCH 1: Send Telegram notification with FIXED bot query and skip/fail separation
async function sendTelegramReminder(
  supabase: any,
  botToken: string | null, // PATCH: Pass cached bot token
  userId: string,
  productName: string,
  tariffName: string,
  expiryDate: Date,
  daysLeft: number,
  amount: number,
  currency: string,
  hasCard: boolean,
  subscriptionId: string,
  orderId: string | null,
  tariffId: string | null
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

    // PATCH 2: SKIP - No Telegram linked (not a failure)
    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      // Log SKIP to telegram_logs
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
      
      // Handle duplicate (23505) as success, not error
      const isDuplicate = skipLogError?.code === '23505';
      
      return { 
        sent: false, 
        logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_telegram_linked',
        failReason: null,
        errorStage: 'load_profile',
        duplicateSuppressed: isDuplicate,
      };
    }

    // PATCH 1: SKIP - No bot configured (already logged at run start)
    if (!botToken) {
      // Log SKIP to telegram_logs
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
        sent: false, 
        logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_link_bot_configured',
        failReason: null,
        errorStage: null,
        duplicateSuppressed: isDuplicate,
      };
    }

    const userName = profile.full_name?.split(' ')[0] || 'Клиент';
    const formattedDate = expiryDate.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long' 
    });

    const priceInfo = hasCard ? `\n💳 *Сумма к списанию:* ${formatCurrency(amount, currency)}` : '';
    const ctaUrl = hasCard 
      ? 'https://club.gorbova.by/purchases' 
      : 'https://club.gorbova.by/settings/payment-methods';
    const ctaText = hasCard ? 'Управление подпиской' : 'Привязать карту и сохранить цену';
    
    if (daysLeft === 7) {
      message = `📅 *Напоминание о подписке*

${userName}, ваша подписка заканчивается через неделю.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

${hasCard 
  ? '✅ У вас привязана карта, подписка продлится автоматически.' 
  : '⚠️ Чтобы продлить доступ, привяжите карту.'}

🔗 [${ctaText}](${ctaUrl})`;
    } else if (daysLeft === 3) {
      if (hasCard) {
        message = `⏰ *Подписка заканчивается через 3 дня*

${userName}, осталось 3 дня до окончания вашей подписки.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

💳 Через 3 дня с вашей карты будет списана оплата за продление.

🔗 [${ctaText}](${ctaUrl})`;
      } else {
        message = `⏰ *Через 3 дня подписка может прерваться*

${userName}, для продолжения нужна привязанная карта.

📦 *${productName}* / ${tariffName}
📆 Доступ до: ${formattedDate}

⚠️ *Важно:* Сейчас за вами закреплена старая (выгодная) цена. 
Если подписка прервется, повторный вход будет по новым, более высоким тарифам.

🔗 [${ctaText}](${ctaUrl})`;
      }
    } else if (daysLeft === 1) {
      if (hasCard) {
        message = `🔔 *Завтра заканчивается подписка!*

${userName}, это последнее напоминание.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

💳 Завтра мы автоматически продлим вашу подписку.

🔗 [${ctaText}](${ctaUrl})`;
      } else {
        message = `🛑 *Завтра доступ может быть ограничен*

${userName}, это последнее напоминание.

📦 *${productName}*
📆 Истекает: ${formattedDate}

❗ Если оплата не пройдет, ваша текущая цена «сгорит», и следующий вход будет стоить дороже.

Уделите 1 минуту сейчас:
🔗 [Привязать карту](${ctaUrl})`;
      }
    }

    if (!message) return { sent: false, logged: false, logError: 'Invalid daysLeft', skipReason: null, failReason: null };

    // Send Telegram message
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const result = await response.json();
    sent = result.ok === true;

    // PATCH 2: FAIL - Telegram API error
    if (!sent) {
      const telegramError = result.description || `HTTP ${response.status}`;
      
      // Log FAIL to telegram_logs
      const { error: failLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_REMINDER',
        event_type: `subscription_reminder_${daysLeft}d`,
        user_id: userId,
        status: 'failed',
        error_message: telegramError,
        message_text: message,
        meta: {
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
          has_card: hasCard,
          telegram_error_code: result.error_code,
          telegram_response: result,
        },
      });

      const isDuplicate = failLogError?.code === '23505';

      return {
        sent: false,
        logged: !failLogError || isDuplicate,
        logError: (failLogError && !isDuplicate) ? failLogError.message : null,
        skipReason: null,
        failReason: 'send_failed',
        errorStage: 'send_api',
        telegramApiError: telegramError,
        duplicateSuppressed: isDuplicate,
      };
    }

    // SUCCESS - Log to telegram_logs
    const { error: insertError } = await supabase.from('telegram_logs').insert({
      action: 'SEND_REMINDER',
      event_type: `subscription_reminder_${daysLeft}d`,
      user_id: userId,
      status: 'success',
      message_text: message,
      meta: {
        days_left: daysLeft,
        product: productName,
        tariff: tariffName,
        subscription_id: subscriptionId,
        order_id: orderId,
        tariff_id: tariffId,
        has_card: hasCard,
      },
    });

    const isDuplicate = insertError?.code === '23505';

    if (insertError && !isDuplicate) {
      logError = insertError.message;
      console.error('Failed to log telegram reminder:', insertError);
      return {
        sent: true,
        logged: false,
        logError,
        skipReason: null,
        failReason: 'log_insert_failed',
        errorStage: 'insert_log',
      };
    } else {
      logged = true;
    }

    return { 
      sent, 
      logged, 
      logError: null, 
      skipReason: null, 
      failReason: null,
      duplicateSuppressed: isDuplicate,
    };
  } catch (err) {
    console.error('Failed to send Telegram reminder:', err);
    return { 
      sent: false, 
      logged: false, 
      logError: err instanceof Error ? err.message : 'Unknown error',
      skipReason: null,
      failReason: 'send_failed',
      errorStage: 'send_api',
    };
  }
}

// PATCH 1: Send "No Card" warning with FIXED bot query
async function sendNoCardWarning(
  supabase: any,
  botToken: string | null, // PATCH: Pass cached bot token
  userId: string,
  productName: string,
  accessEndAt: string,
  daysLeft: number,
  subscriptionId: string,
  orderId: string | null,
  tariffId: string | null
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

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_status, full_name, email')
      .eq('user_id', userId)
      .single();

    // PATCH 2: SKIP - No Telegram linked
    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      const { error: skipLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_NO_CARD_WARNING',
        event_type: 'subscription_no_card_warning',
        user_id: userId,
        status: 'skipped',
        message_text: null,
        error_message: null,
        meta: {
          reason: 'no_telegram_linked',
          message_template_key: 'no_card_warning',
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
        },
      });
      
      const isDuplicate = skipLogError?.code === '23505';
      
      return { 
        sent: false, 
        logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_telegram_linked',
        duplicateSuppressed: isDuplicate,
      };
    }

    // PATCH 1: SKIP - No bot configured
    if (!botToken) {
      const { error: skipLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_NO_CARD_WARNING',
        event_type: 'subscription_no_card_warning',
        user_id: userId,
        status: 'skipped',
        message_text: null,
        error_message: null,
        meta: {
          reason: 'no_link_bot_configured',
          message_template_key: 'no_card_warning',
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
        },
      });
      
      const isDuplicate = skipLogError?.code === '23505';
      
      return { 
        sent: false, 
        logged: !skipLogError || isDuplicate,
        logError: (skipLogError && !isDuplicate) ? skipLogError.message : null,
        skipReason: 'no_link_bot_configured',
        duplicateSuppressed: isDuplicate,
      };
    }

    const userName = profile.full_name?.split(' ')[0] || 'Клиент';
    const formattedDate = new Date(accessEndAt).toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long' 
    });

    const message = `⚠️ *Карта не привязана*

${userName}, через ${daysLeft} ${getDaysWord(daysLeft)} заканчивается ваша подписка на *${productName}*.

Без привязанной карты:
❌ Списание не пройдёт
❌ Доступ не продлится

❗ *При повторном вступлении цена будет выше!*

📆 Доступ до: ${formattedDate}

Уделите 1 минуту сейчас — привяжите карту:
🔗 [Привязать карту](https://club.gorbova.by/settings/payment-methods)`;

    // Send Telegram message
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const result = await response.json();
    sent = result.ok === true;

    // PATCH 2: FAIL - Telegram API error
    if (!sent) {
      const telegramError = result.description || `HTTP ${response.status}`;
      
      const { error: failLogError } = await supabase.from('telegram_logs').insert({
        action: 'SEND_NO_CARD_WARNING',
        event_type: 'subscription_no_card_warning',
        user_id: userId,
        status: 'failed',
        error_message: telegramError,
        message_text: message,
        meta: {
          subscription_id: subscriptionId,
          order_id: orderId,
          tariff_id: tariffId,
          days_left: daysLeft,
          access_end_at: accessEndAt,
          telegram_error_code: result.error_code,
          telegram_response: result,
        },
      });

      const isDuplicate = failLogError?.code === '23505';

      return {
        sent: false,
        logged: !failLogError || isDuplicate,
        logError: (failLogError && !isDuplicate) ? failLogError.message : null,
        skipReason: null,
        failReason: 'send_failed',
        errorStage: 'send_api',
        telegramApiError: telegramError,
        duplicateSuppressed: isDuplicate,
      };
    }

    // SUCCESS - Log to telegram_logs
    const { error: insertError } = await supabase.from('telegram_logs').insert({
      action: 'SEND_NO_CARD_WARNING',
      event_type: 'subscription_no_card_warning',
      user_id: userId,
      status: 'success',
      message_text: message,
      meta: {
        days_left: daysLeft,
        product: productName,
        subscription_id: subscriptionId,
        order_id: orderId,
        tariff_id: tariffId,
        access_end_at: accessEndAt,
      },
    });

    const isDuplicate = insertError?.code === '23505';

    if (insertError && !isDuplicate) {
      logError = insertError.message;
      console.error('Failed to log no-card warning:', insertError);
      return {
        sent: true,
        logged: false,
        logError,
        skipReason: null,
        failReason: 'log_insert_failed',
        errorStage: 'insert_log',
      };
    } else {
      logged = true;
    }

    return { 
      sent, 
      logged, 
      logError: null,
      duplicateSuppressed: isDuplicate,
    };
  } catch (err) {
    console.error('Failed to send no-card warning:', err);
    return { 
      sent: false, 
      logged: false, 
      logError: err instanceof Error ? err.message : 'Unknown error',
      failReason: 'send_failed',
      errorStage: 'send_api',
    };
  }
}

// Send email reminder
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
  hasCard: boolean,
  subscriptionId: string,
  orderId: string | null,
  tariffId: string | null
): Promise<boolean> {
  try {
    const formattedDate = expiryDate.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    });

    let subject = '';
    let bodyHtml = '';

    const ctaUrl = hasCard 
      ? 'https://club.gorbova.by/purchases' 
      : 'https://club.gorbova.by/settings/payment-methods';
    const ctaText = hasCard ? 'Управление подпиской' : 'Привязать карту и сохранить цену';

    const cardSection = hasCard 
      ? `<p style="color: #059669; margin: 16px 0;">✅ У вас привязана карта. Подписка будет продлена автоматически на сумму <strong>${formatCurrency(amount, currency)}</strong>.</p>`
      : `<div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0; font-weight: 600; color: #92400e;">⚠️ Важно:</p>
          <p style="margin: 8px 0 0 0; color: #78350f;">Сейчас за вами закреплена <strong>выгодная цена</strong>. Если подписка прервется, повторный вход будет по новым, более высоким тарифам.</p>
        </div>`;

    if (daysLeft === 7) {
      subject = hasCard ? '📅 Напоминание: подписка заканчивается через неделю' : '📅 Сохраните вашу стоимость участия в клубе';
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
          
          ${cardSection}
          
          <p style="margin-top: 24px;">
            <a href="${ctaUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              ${ctaText}
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    } else if (daysLeft === 3) {
      subject = hasCard ? '⏰ Подписка заканчивается через 3 дня' : '⏰ Через 3 дня подписка может прерваться';
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
          
          ${cardSection}
          
          <p style="margin-top: 24px;">
            <a href="${ctaUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              ${ctaText}
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    } else if (daysLeft === 1) {
      subject = hasCard ? '🔔 Завтра заканчивается подписка!' : '🛑 Завтра доступ может быть ограничен';
      bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #dc2626; font-size: 24px; margin-bottom: 20px;">${hasCard ? 'Последнее напоминание!' : '⚠️ Последний шанс сохранить цену!'}</h1>
          <p>Здравствуйте!</p>
          <p>Ваша подписка заканчивается <strong>завтра</strong>.</p>
          
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0;"><strong>📦 Продукт:</strong> ${productName}</p>
            <p style="margin: 0 0 8px 0;"><strong>🎯 Тариф:</strong> ${tariffName}</p>
            <p style="margin: 0;"><strong>📆 Дата окончания:</strong> ${formattedDate}</p>
          </div>
          
          ${cardSection}
          
          <p style="margin-top: 24px;">
            <a href="${ctaUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              ${hasCard ? 'Управление подпиской' : 'Привязать карту сейчас'}
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    }

    if (!subject) return false;

    // Determine event type based on daysLeft
    const eventType = `subscription_reminder_${daysLeft}d`;

    const { error } = await supabase.functions.invoke('send-email', {
      body: {
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
            has_card: hasCard,
            source: 'subscription-renewal-reminders',
            order_id: orderId,
            tariff_id: tariffId,
          }
        }
      },
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

// Check if reminder was already sent today (legacy - kept for compatibility)
async function wasReminderSentToday(
  supabase: any,
  userId: string,
  eventType: string
): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('telegram_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('created_at', today.toISOString())
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

    console.log(`Starting subscription renewal reminders job... Source: ${source}`);

    const now = new Date();
    const results: ReminderResult[] = [];

    // ============ PATCH 1: Load link bot ONCE at start of run ============
    const { data: linkBot, error: botError } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, bot_name, status, is_primary, bot_token_encrypted')
      .eq('is_primary', true)
      .eq('status', 'active')
      .limit(1)
      .single();

    // CRITICAL: bot_token_encrypted is actually plaintext (misnomer), use directly
    const botToken = linkBot?.bot_token_encrypted ?? null;
    const linkBotMissing = !botToken;

    console.log(`Link bot status: ${linkBotMissing ? 'NOT FOUND' : `@${linkBot?.bot_username}`}`);

    // PATCH 1: Log bot_config_missing ONCE if no bot
    if (linkBotMissing) {
      await supabase.from('audit_logs').insert({
        action: 'telegram.bot_config_missing',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'subscription-renewal-reminders',
        meta: {
          run_at: now.toISOString(),
          source,
          query: 'is_primary=true AND status=active',
          hint: 'Check telegram_bots table: need is_primary=true AND status=active',
          bot_error: botError?.message || null,
          env_check: {
            has_supabase_url: !!supabaseUrl,
            has_service_key: !!supabaseServiceKey,
          },
        },
      });
    }

    // ============ STANDARD REMINDERS (7, 3, 1 days by access_end_at) ============
    for (const daysLeft of [7, 3, 1]) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysLeft);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`Checking subscriptions expiring in ${daysLeft} days (${startOfDay.toISOString()} to ${endOfDay.toISOString()})`);

      const { data: subscriptions, error } = await supabase
        .from('subscriptions_v2')
        .select(`
          id,
          user_id,
          order_id,
          access_end_at,
          payment_token,
          tariff_id,
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
        .gte('access_end_at', startOfDay.toISOString())
        .lte('access_end_at', endOfDay.toISOString())
        .eq('auto_renew', true);

      if (error) {
        console.error(`Query error for ${daysLeft} days:`, error);
        continue;
      }

      console.log(`Found ${subscriptions?.length || 0} subscriptions expiring in ${daysLeft} days`);

      for (const sub of subscriptions || []) {
        const userId = sub.user_id;
        
        // Check if already sent today (legacy check, idempotency now handled by DB unique constraint)
        if (await wasReminderSentToday(supabase, userId, `subscription_reminder_${daysLeft}d`)) {
          console.log(`Reminder already sent today for user ${userId}, skipping`);
          continue;
        }

        // Get user profile and email
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, full_name')
          .eq('user_id', userId)
          .single();

        let userEmail = profile?.email;
        if (!userEmail) {
          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          userEmail = authUser?.user?.email;
        }

        // Check if user has active payment method
        const { data: paymentMethod } = await supabase
          .from('payment_methods')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1)
          .single();

        const hasCard = !!paymentMethod;

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
        const productName = product?.name || 'Подписка';
        const tariffName = tariff?.name || 'Стандартный';
        const expiryDate = new Date(sub.access_end_at);

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

        // PATCH 1: Send Telegram reminder with cached bot token
        const telegramResult = await sendTelegramReminder(
          supabase,
          botToken, // PATCH: Pass cached token
          userId,
          productName,
          tariffName,
          expiryDate,
          daysLeft,
          amount,
          currency,
          hasCard,
          sub.id,
          sub.order_id,
          sub.tariff_id
        );

        result.telegram_sent = telegramResult.sent;
        result.telegram_logged = telegramResult.logged;
        result.telegram_log_error = telegramResult.logError;
        result.skip_reason = telegramResult.skipReason;
        result.fail_reason = telegramResult.failReason;
        result.error_stage = telegramResult.errorStage;
        result.telegram_api_error = telegramResult.telegramApiError;
        result.duplicate_suppressed = telegramResult.duplicateSuppressed;

        // Send email reminder
        if (userEmail) {
          // Get profile_id for email context
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', userId)
            .single();
          
          result.email_sent = await sendEmailReminder(
            supabase,
            userId,
            profile?.id || null,
            userEmail,
            productName,
            tariffName,
            expiryDate,
            daysLeft,
            amount,
            currency,
            hasCard,
            sub.id,
            sub.order_id,
            sub.tariff_id
          );
        }

        results.push(result);
        console.log(`Processed reminder for user ${userId}: Telegram sent=${result.telegram_sent}, logged=${result.telegram_logged}, skip=${result.skip_reason || 'none'}, Email=${result.email_sent}`);
      }
    }

    // ============ NO-CARD WARNING ============
    console.log('Checking for no-card warnings...');
    
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const { data: noCardSubs } = await supabase
      .from('subscriptions_v2')
      .select(`
        id,
        user_id,
        order_id,
        access_end_at,
        tariff_id,
        tariffs (
          name,
          products_v2 (name)
        )
      `)
      .eq('auto_renew', true)
      .in('status', ['active', 'trial'])
      .is('payment_method_id', null)
      .lte('access_end_at', sevenDaysFromNow.toISOString())
      .gte('access_end_at', now.toISOString())
      .limit(100);

    console.log(`Found ${noCardSubs?.length || 0} subscriptions without card expiring within 7 days`);

    for (const sub of noCardSubs || []) {
      const userId = sub.user_id;

      // Check if already sent today
      if (await wasReminderSentToday(supabase, userId, 'subscription_no_card_warning')) {
        console.log(`No-card warning already sent today for user ${userId}, skipping`);
        continue;
      }

      const tariff = sub.tariffs as any;
      const product = tariff?.products_v2 as any;
      const productName = product?.name || tariff?.name || 'Подписка';

      const accessEndAt = new Date(sub.access_end_at);
      const daysLeft = Math.ceil((accessEndAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // PATCH 1: Send no-card warning with cached bot token
      const telegramResult = await sendNoCardWarning(
        supabase,
        botToken, // PATCH: Pass cached token
        userId, 
        productName, 
        sub.access_end_at, 
        daysLeft,
        sub.id,
        sub.order_id,
        sub.tariff_id
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
        reminder_type: 'no_card_warning',
        skip_reason: telegramResult.skipReason,
        fail_reason: telegramResult.failReason,
        error_stage: telegramResult.errorStage,
        telegram_api_error: telegramResult.telegramApiError,
        duplicate_suppressed: telegramResult.duplicateSuppressed,
      });

      console.log(`No-card warning for user ${userId}: sent=${telegramResult.sent}, logged=${telegramResult.logged}, skip=${telegramResult.skipReason || 'none'}`);
    }

    // ============ PATCH 4: Collect detailed statistics with SKIP/FAIL separation ============
    const reminders7d = results.filter(r => r.days_until_expiry === 7 && r.reminder_type === 'expiry_reminder');
    const reminders3d = results.filter(r => r.days_until_expiry === 3 && r.reminder_type === 'expiry_reminder');
    const reminders1d = results.filter(r => r.days_until_expiry === 1 && r.reminder_type === 'expiry_reminder');
    const noCardWarnings = results.filter(r => r.reminder_type === 'no_card_warning');

    // PATCH 4: Separate skip/fail counts
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
      // PATCH 4: New skip/fail counts
      skipped_no_telegram_linked: skippedNoTelegram.length,
      skipped_no_link_bot: skippedNoBot.length,
      failed_send: failedSend.length,
      failed_log_insert: failedLogInsert.length,
      duplicate_suppressed: duplicateSuppressed.length,
    };

    // PATCH 4: Enhanced SYSTEM ACTOR audit log with separated metrics
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
        
        // PATCH 4: New detailed counts by day
        reminders_7d_sent: reminders7d.filter(r => r.telegram_sent).length,
        reminders_3d_sent: reminders3d.filter(r => r.telegram_sent).length,
        reminders_1d_sent: reminders1d.filter(r => r.telegram_sent).length,
        no_card_warnings_sent: noCardWarnings.filter(r => r.telegram_sent).length,
        
        // Legacy fields for compatibility
        expiry_reminders_sent: results.filter(r => r.reminder_type === 'expiry_reminder' && r.telegram_sent).length,
        
        // PATCH 4: Split sent/logged counts
        telegram_sent_count: results.filter(r => r.telegram_sent).length,
        telegram_logged_count: results.filter(r => r.telegram_logged).length,
        
        // PATCH 4: SEPARATE skip/fail metrics
        skipped_no_telegram_linked_count: skippedNoTelegram.length,
        skipped_no_link_bot_count: skippedNoBot.length,
        failed_send_count: failedSend.length,
        failed_log_insert_count: failedLogInsert.length,
        
        // PATCH 5: Duplicate suppression count
        duplicate_suppressed_count: duplicateSuppressed.length,
        
        // PATCH 4: Separate samples (limit 10-20)
        skip_samples: [...skippedNoTelegram, ...skippedNoBot]
          .slice(0, 10)
          .map(r => ({ 
            user_id: r.user_id, 
            subscription_id: r.subscription_id, 
            reason: r.skip_reason 
          })),
        
        fail_samples: [...failedSend, ...failedLogInsert]
          .slice(0, 20)
          .map(r => ({ 
            user_id: r.user_id, 
            subscription_id: r.subscription_id, 
            reason: r.fail_reason,
            stage: r.error_stage,
            error: r.telegram_api_error || r.telegram_log_error,
          })),
        
        // PATCH 5: Duplicate samples
        duplicate_samples: duplicateSuppressed.length > 0 
          ? duplicateSuppressed.slice(0, 10).map(r => ({
              user_id: r.user_id,
              subscription_id: r.subscription_id,
            }))
          : undefined,
        
        // PATCH 4: Recipients lists (limit 50 each)
        recipients_7d: reminders7d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ 
          user_id: r.user_id, 
          subscription_id: r.subscription_id 
        })),
        recipients_3d: reminders3d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ 
          user_id: r.user_id, 
          subscription_id: r.subscription_id 
        })),
        recipients_1d: reminders1d.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ 
          user_id: r.user_id, 
          subscription_id: r.subscription_id 
        })),
        no_card_recipients: noCardWarnings.filter(r => r.telegram_sent).slice(0, 50).map(r => ({ 
          user_id: r.user_id, 
          subscription_id: r.subscription_id 
        })),
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
