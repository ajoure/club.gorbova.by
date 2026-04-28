import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { greetSuffix } from '../_shared/recipient-name.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[send-recovery-notifications] Starting recovery notifications job...');

    // Find active subscriptions without card
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions_v2')
      .select(`
        id,
        user_id,
        products_v2(name),
        tariffs(name)
      `)
      .eq('status', 'active')
      .is('payment_method_id', null);

    if (subsError) {
      throw new Error(`Failed to fetch subscriptions: ${subsError.message}`);
    }

    console.log(`[send-recovery-notifications] Found ${subscriptions?.length || 0} active subscriptions without card`);

    const results = {
      total: subscriptions?.length || 0,
      telegram_sent: 0,
      email_sent: 0,
      errors: [] as string[],
    };

    // Get link bot token
    const { data: linkBot } = await supabase
      .from('telegram_bots')
      .select('token')
      .eq('is_link_bot', true)
      .eq('is_active', true)
      .limit(1)
      .single();

    for (const sub of subscriptions || []) {
      const productName = (sub.products_v2 as any)?.name || 'Подписка';
      const tariffName = (sub.tariffs as any)?.name || '';

      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, telegram_link_status, full_name, email')
        .eq('user_id', sub.user_id)
        .single();

      // Get email from auth if not in profile
      let userEmail = profile?.email;
      if (!userEmail) {
        const { data: authUser } = await supabase.auth.admin.getUserById(sub.user_id);
        userEmail = authUser?.user?.email;
      }

      const greet = greetSuffix(profile); // ", Имя" либо ""

      // Telegram message with price protection emphasis (обращение на «Вы»)
      const telegramMessage = `👋 Здравствуйте${greet}!

Мы обновили систему безопасности платежей, и теперь для автоматического продления подписки нужна привязанная карта.

🔒 Это повышает защиту Ваших данных.

📌 *Почему это важно:*
Сейчас за Вами закреплена *выгодная цена* на "${productName}"${tariffName ? ` (${tariffName})` : ''}.

⚠️ Если подписка прервётся, повторный вход будет по новым, более высоким тарифам.

🔗 [Привязать карту и сохранить цену](https://club.gorbova.by/settings/payment-methods)

Если возникнут вопросы — мы всегда на связи! 💜`;

      // Send Telegram
      if (profile?.telegram_user_id && profile.telegram_link_status === 'active' && linkBot?.token) {
        try {
          const tgResponse = await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: profile.telegram_user_id,
              text: telegramMessage,
              parse_mode: 'Markdown',
            }),
          });

          if (tgResponse.ok) {
            results.telegram_sent++;
            console.log(`[send-recovery-notifications] Telegram sent to user ${sub.user_id}`);
          } else {
            const errorData = await tgResponse.json();
            console.error(`[send-recovery-notifications] Telegram error for ${sub.user_id}:`, errorData);
          }
        } catch (err) {
          console.error(`[send-recovery-notifications] Telegram send failed for ${sub.user_id}:`, err);
          results.errors.push(`TG error for ${sub.user_id}: ${err}`);
        }
      }

      // Send Email
      if (userEmail) {
        try {
          const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px;">Сохраните вашу стоимость участия в клубе 💜</h1>
              
              <p>Здравствуйте${greet}!</p>
              
              <p>Мы обновили систему безопасности платежей, и теперь для автоматического продления подписки нужна привязанная карта.</p>
              
              <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0; font-weight: 600; color: #92400e;">⚠️ Почему это важно:</p>
                <p style="margin: 8px 0 0 0; color: #78350f;">
                  Сейчас за Вами закреплена <strong>выгодная цена</strong> на "${productName}". 
                  Если подписка прервётся, повторный вход будет по новым, более высоким тарифам.
                </p>
              </div>
              
              <p style="margin-top: 24px;">
                <a href="https://club.gorbova.by/settings/payment-methods" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                  Привязать карту и сохранить цену
                </a>
              </p>
              
              <p style="color: #6b7280; margin-top: 32px; font-size: 14px;">
                Если возникнут вопросы — мы всегда на связи!<br><br>
                С уважением,<br>Команда клуба
              </p>
            </div>
          `;

          const { error: emailError } = await supabase.functions.invoke('send-email', {
            body: {
              to: userEmail,
              subject: 'Сохраните вашу стоимость участия в клубе 💜',
              html: emailHtml,
            },
          });

          if (!emailError) {
            results.email_sent++;
            console.log(`[send-recovery-notifications] Email sent to ${userEmail}`);
          } else {
            console.error(`[send-recovery-notifications] Email error for ${userEmail}:`, emailError);
          }
        } catch (err) {
          console.error(`[send-recovery-notifications] Email send failed for ${userEmail}:`, err);
          results.errors.push(`Email error for ${userEmail}: ${err}`);
        }
      }
    }

    // Log to audit
    await supabase.from('audit_logs').insert({
      action: 'recovery_notifications.sent',
      actor_type: 'admin',
      meta: {
        total: results.total,
        telegram_sent: results.telegram_sent,
        email_sent: results.email_sent,
        errors_count: results.errors.length,
      },
    });

    console.log('[send-recovery-notifications] Completed:', results);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[send-recovery-notifications] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
