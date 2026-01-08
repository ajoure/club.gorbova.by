import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types
interface ReminderResult {
  user_id: string;
  subscription_id: string;
  days_until_expiry: number;
  telegram_sent: boolean;
  email_sent: boolean;
  error?: string;
}

// Format currency
function formatCurrency(amount: number, currency: string = 'BYN'): string {
  return `${amount.toFixed(2)} ${currency}`;
}

// Send Telegram notification
async function sendTelegramReminder(
  supabase: any,
  userId: string,
  productName: string,
  tariffName: string,
  expiryDate: Date,
  daysLeft: number,
  amount: number,
  currency: string,
  hasCard: boolean
): Promise<boolean> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('telegram_user_id, telegram_link_status, full_name')
      .eq('user_id', userId)
      .single();

    if (!profile?.telegram_user_id || profile.telegram_link_status !== 'active') {
      return false;
    }

    const { data: linkBot } = await supabase
      .from('telegram_bots')
      .select('token')
      .eq('is_link_bot', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!linkBot?.token) return false;

    const userName = profile.full_name?.split(' ')[0] || 'Клиент';
    const formattedDate = expiryDate.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long' 
    });

    let message = '';
    const priceInfo = hasCard ? `\n💳 *Сумма к списанию:* ${formatCurrency(amount, currency)}` : '';
    
    if (daysLeft === 7) {
      message = `📅 *Напоминание о подписке*

${userName}, ваша подписка заканчивается через неделю.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

${hasCard 
  ? '✅ У вас привязана карта, подписка продлится автоматически.' 
  : '⚠️ Чтобы продлить доступ, привяжите карту или оплатите вручную.'}

🔗 [Управление подпиской](https://club.gorbova.by/purchases)`;
    } else if (daysLeft === 3) {
      message = `⏰ *Подписка заканчивается через 3 дня*

${userName}, осталось 3 дня до окончания вашей подписки.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

${hasCard 
  ? '💳 Через 3 дня с вашей карты будет списана оплата за продление.' 
  : '⚠️ Привяжите карту, чтобы не потерять доступ.'}

🔗 [Управление подпиской](https://club.gorbova.by/purchases)`;
    } else if (daysLeft === 1) {
      message = `🔔 *Завтра заканчивается подписка!*

${userName}, это последнее напоминание.

📦 *Продукт:* ${productName}
🎯 *Тариф:* ${tariffName}
📆 *Дата окончания:* ${formattedDate}${priceInfo}

${hasCard 
  ? '💳 Завтра мы автоматически продлим вашу подписку.' 
  : '❗ Срочно привяжите карту или оплатите вручную, иначе доступ будет закрыт.'}

🔗 [Управление подпиской](https://club.gorbova.by/purchases)`;
    }

    if (!message) return false;

    await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: profile.telegram_user_id,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    // Log reminder sent
    await supabase.from('telegram_logs').insert({
      event_type: `subscription_reminder_${daysLeft}d`,
      user_id: userId,
      status: 'success',
      payload: { days_left: daysLeft, product: productName },
    });

    return true;
  } catch (err) {
    console.error('Failed to send Telegram reminder:', err);
    return false;
  }
}

// Send email reminder
async function sendEmailReminder(
  supabase: any,
  userId: string,
  email: string,
  productName: string,
  tariffName: string,
  expiryDate: Date,
  daysLeft: number,
  amount: number,
  currency: string,
  hasCard: boolean
): Promise<boolean> {
  try {
    const formattedDate = expiryDate.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long',
      year: 'numeric'
    });

    let subject = '';
    let bodyHtml = '';

    const cardSection = hasCard 
      ? `<p style="color: #059669; margin: 16px 0;">✅ У вас привязана карта. Подписка будет продлена автоматически на сумму <strong>${formatCurrency(amount, currency)}</strong>.</p>`
      : `<p style="color: #d97706; margin: 16px 0;">⚠️ Чтобы продолжить пользоваться сервисом, <a href="https://club.gorbova.by/settings/payment-methods" style="color: #7c3aed;">привяжите карту</a> или оплатите вручную.</p>`;

    if (daysLeft === 7) {
      subject = `📅 Напоминание: подписка заканчивается через неделю`;
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
            <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Управление подпиской
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    } else if (daysLeft === 3) {
      subject = `⏰ Подписка заканчивается через 3 дня`;
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
            <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Управление подпиской
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    } else if (daysLeft === 1) {
      subject = `🔔 Завтра заканчивается подписка!`;
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
          
          ${cardSection}
          
          <p style="margin-top: 24px;">
            <a href="https://club.gorbova.by/purchases" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Продлить сейчас
            </a>
          </p>
          
          <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
            С уважением,<br>Команда клуба
          </p>
        </div>
      `;
    }

    if (!subject) return false;

    // Send email via send-email function
    const { error } = await supabase.functions.invoke('send-email', {
      body: {
        to: email,
        subject,
        html: bodyHtml,
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

// Check if reminder was already sent today
async function wasReminderSentToday(
  supabase: any,
  userId: string,
  daysLeft: number
): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('telegram_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', `subscription_reminder_${daysLeft}d`)
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

    console.log('Starting subscription renewal reminders job...');

    const now = new Date();
    const results: ReminderResult[] = [];

    // Find subscriptions expiring in 7, 3, or 1 days
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
          access_end_at,
          payment_token,
          tariff_id,
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
        .neq('cancel_at_period_end', true);

      if (error) {
        console.error(`Query error for ${daysLeft} days:`, error);
        continue;
      }

      console.log(`Found ${subscriptions?.length || 0} subscriptions expiring in ${daysLeft} days`);

      for (const sub of subscriptions || []) {
        const userId = sub.user_id;
        
        // Check if already sent today
        if (await wasReminderSentToday(supabase, userId, daysLeft)) {
          console.log(`Reminder already sent today for user ${userId}, skipping`);
          continue;
        }

        // Get user profile and email
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, full_name')
          .eq('user_id', userId)
          .single();

        // Get user email from auth if not in profile
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
          days_until_expiry: daysLeft,
          telegram_sent: false,
          email_sent: false,
        };

        // Send Telegram reminder
        result.telegram_sent = await sendTelegramReminder(
          supabase,
          userId,
          productName,
          tariffName,
          expiryDate,
          daysLeft,
          amount,
          currency,
          hasCard
        );

        // Send email reminder
        if (userEmail) {
          result.email_sent = await sendEmailReminder(
            supabase,
            userId,
            userEmail,
            productName,
            tariffName,
            expiryDate,
            daysLeft,
            amount,
            currency,
            hasCard
          );
        }

        results.push(result);
        console.log(`Processed reminder for user ${userId}: Telegram=${result.telegram_sent}, Email=${result.email_sent}`);
      }
    }

    const summary = {
      total: results.length,
      telegram_sent: results.filter(r => r.telegram_sent).length,
      email_sent: results.filter(r => r.email_sent).length,
      results,
    };

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
