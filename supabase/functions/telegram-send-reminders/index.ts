import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateRenewalCTAs } from '../_shared/generate-renewal-ctas.ts';
import { resolveProductRenewability } from '../_shared/renewal-offer-resolver.ts';
import { greetPrefix } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telegram API helper
async function telegramRequest(botToken: string, method: string, params?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

/**
 * PATCH RENEWAL-RESOLVER v2 (2026-04-28):
 * Resolve product + renewable tariff for a (user, club).
 * Strategy:
 *   1. Find product mapped to this club.
 *   2. Use shared resolveProductRenewability(product) — based on tariff_offers,
 *      not on user's subscription state.
 *   3. If user has an existing subscription tariff that is renewable — prefer it.
 *   4. Else — fall back to preferredOffer from resolver.
 *   5. If product has no renewable offer — return { renewable:false } so caller
 *      can show "разовая покупка — продление не требуется".
 */
async function resolveProductAndTariff(
  supabase: any,
  userId: string,
  clubId: string,
): Promise<
  | {
      productId: string;
      productName: string;
      renewable: true;
      tariffId: string;
      amount: number;
      kind: 'recurring' | 'installment' | 'subscription_offer';
      hasActivePM: boolean;
    }
  | { productId: string; productName: string; renewable: false; reason: string }
  | null
> {
  const { data: product } = await supabase
    .from('products_v2')
    .select('id, name')
    .eq('telegram_club_id', clubId)
    .eq('status', 'active')
    .maybeSingle();

  if (!product) {
    console.log(`[tg-reminders] No product mapped to club ${clubId}`);
    return null;
  }

  // Try to find user's existing tariff for preference
  const { data: sub } = await supabase
    .from('subscriptions_v2')
    .select('tariff_id, billing_type')
    .eq('user_id', userId)
    .eq('product_id', product.id)
    .in('status', ['active', 'trial', 'past_due', 'canceled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const preferredTariffId = sub?.tariff_id ?? null;
  const hasActivePM = sub?.billing_type === 'provider_managed';

  const r = await resolveProductRenewability(supabase, product.id, preferredTariffId);

  if (!r.renewable || !r.preferredOffer) {
    return {
      productId: product.id,
      productName: product.name,
      renewable: false,
      reason: r.reason,
    };
  }

  const offer = r.preferredOffer;
  if (offer.amount < 1) {
    return {
      productId: product.id,
      productName: product.name,
      renewable: false,
      reason: 'amount_too_small',
    };
  }

  return {
    productId: product.id,
    productName: product.name,
    renewable: true,
    tariffId: offer.tariff_id,
    amount: Number(offer.amount), // BYN
    kind: offer.kind as 'recurring' | 'installment' | 'subscription_offer',
    hasActivePM,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting subscription reminder check...');

    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

    // Find users whose subscription expires in 3 days (between 2 and 3 days from now)
    const { data: expiringAccess, error: queryError } = await supabase
      .from('telegram_access')
      .select(`
        id,
        user_id,
        club_id,
        active_until,
        telegram_clubs(
          club_name,
          bot_id,
          telegram_bots(bot_token_encrypted)
        )
      `)
      .or('state_chat.eq.active,state_channel.eq.active')
      .gte('active_until', twoDaysFromNow.toISOString())
      .lte('active_until', threeDaysFromNow.toISOString());

    if (queryError) {
      console.error('Failed to query expiring access:', queryError);
      throw queryError;
    }

    if (!expiringAccess || expiringAccess.length === 0) {
      console.log('No expiring subscriptions found for reminder');
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0,
        message: 'No expiring subscriptions found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${expiringAccess.length} expiring access records`);

    const results = [];
    
    for (const access of expiringAccess) {
      // Check if reminder was already sent today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      const { data: existingLog } = await supabase
        .from('telegram_logs')
        .select('id')
        .eq('user_id', access.user_id)
        .eq('action', 'reminder_sent')
        .gte('created_at', todayStart.toISOString())
        .maybeSingle();

      if (existingLog) {
        console.log(`Reminder already sent today for user ${access.user_id}`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'reminder_already_sent'
        });
        continue;
      }

      // Get user's telegram_user_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_user_id, full_name')
        .eq('user_id', access.user_id)
        .single();

      if (!profile?.telegram_user_id) {
        console.log(`User ${access.user_id} has no Telegram linked`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'no_telegram_linked'
        });
        continue;
      }

      // Check for manual access that might extend beyond
      const { data: manualAccess } = await supabase
        .from('telegram_manual_access')
        .select('*')
        .eq('user_id', access.user_id)
        .eq('club_id', access.club_id)
        .eq('is_active', true)
        .or(`valid_until.is.null,valid_until.gt.${threeDaysFromNow.toISOString()}`)
        .maybeSingle();

      if (manualAccess) {
        console.log(`User ${access.user_id} has extended manual access, skipping reminder`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'manual_access_active'
        });
        continue;
      }

      const club = access.telegram_clubs as any;
      const botToken = club?.telegram_bots?.bot_token_encrypted;
      
      if (!botToken) {
        console.log(`No bot token for club ${access.club_id}`);
        results.push({
          user_id: access.user_id,
          skipped: true,
          reason: 'no_bot_token'
        });
        continue;
      }

      // Format expiry date
      const expiryDate = new Date(access.active_until!);
      const formattedDate = expiryDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      // Resolve product/tariff for CTA generation (uses tariff_offers SOT)
      const resolved = await resolveProductAndTariff(supabase, access.user_id, access.club_id);
      const clubName = club.club_name || 'клубе';

      // hasSBS = у пользователя уже активна провайдерская подписка (автосписание)
      const hasSBS = !!resolved && resolved.renewable === true && resolved.hasActivePM;
      // productRenewable = у продукта в принципе есть возможность продления (по tariff_offers)
      const productRenewable = !!resolved && resolved.renewable === true;
      const installmentMode = productRenewable && (resolved as any).kind === 'installment';

      let message: string;
      let keyboard: any;
      let deliveryMethod: string;

      // PATCH NAME-V: безопасное обращение по имени.
      const namePrefix = greetPrefix(profile);

      if (hasSBS) {
        // Авто-продление активно
        message = `⏰ Небольшое напоминание\n\n${namePrefix}ваша подписка в ${clubName} продлится автоматически ${formattedDate}.\n\nАвтопродление активно — отключить его можно в личном кабинете 💙`;
        const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
        keyboard = {
          inline_keyboard: [[{ text: '📋 Управление подпиской', url: `${siteUrl}/dashboard` }]],
        };
        deliveryMethod = 'sbs_info';
      } else if (productRenewable && resolved) {
        // Продукт продлеваемый — генерируем CTA даже если у юзера нет подписки в БД
        const intro = installmentMode
          ? `⏰ Небольшое напоминание\n\n${namePrefix}ваш доступ в ${clubName} заканчивается ${formattedDate}.\n\nЧтобы продолжить — оплатите следующий платёж рассрочки или оформите полный доступ 💙`
          : `⏰ Небольшое напоминание\n\n${namePrefix}ваша подписка в ${clubName} заканчивается ${formattedDate}.\n\nЧтобы не потерять доступ к чату и материалам, просто продлите её заранее 💙`;
        message = intro;

        const ctas = await generateRenewalCTAs({
          supabase,
          userId: access.user_id,
          productId: resolved.productId,
          tariffId: resolved.tariffId,
          amount: resolved.amount,
          origin: 'https://club.gorbova.by',
          actorType: 'system',
          description: installmentMode
            ? 'Продление доступа (рассрочка, авто-напоминание TG)'
            : 'Продление подписки (авто-напоминание TG)',
        });

        const buttons: Array<Array<{ text: string; url: string }>> = [];
        if (ctas.oneTimeUrl) {
          buttons.push([{ text: ctas.labels.oneTime, url: ctas.oneTimeUrl }]);
        }
        if (ctas.subscriptionUrl) {
          buttons.push([{ text: ctas.labels.subscription, url: ctas.subscriptionUrl }]);
        }

        if (buttons.length > 0) {
          keyboard = { inline_keyboard: buttons };
          deliveryMethod = 'dual_cta_buttons';
        } else {
          const siteUrl = Deno.env.get('SITE_URL') || 'https://club.gorbova.by';
          keyboard = {
            inline_keyboard: [[{ text: '💳 Продлить доступ', url: `${siteUrl}/#pricing` }]],
          };
          deliveryMethod = 'pricing_fallback';
        }
      } else {
        // Продукт действительно разовый — продление не предусмотрено
        message = `⏰ Небольшое напоминание\n\n${namePrefix}ваш доступ в ${clubName} заканчивается ${formattedDate}.\n\nЭто разовая покупка — продление не предусмотрено. Спасибо, что были с нами! 💙`;
        keyboard = undefined;
        deliveryMethod = 'one_time_info';
      }


      const sendPayload: Record<string, unknown> = {
        chat_id: profile.telegram_user_id,
        text: message,
      };
      if (keyboard) sendPayload.reply_markup = keyboard;

      const sendResult = await telegramRequest(botToken, 'sendMessage', sendPayload);

      // If button send failed, try fallback with plain text
      if (!sendResult.ok) {
        console.warn(`[tg-reminders] Send failed for user ${access.user_id}: ${sendResult.description}`);
        const fallbackResult = await telegramRequest(botToken, 'sendMessage', {
          chat_id: profile.telegram_user_id,
          text: message,
        });

        await supabase.from('telegram_logs').insert({
          user_id: access.user_id,
          club_id: access.club_id,
          action: 'reminder_sent',
          target: 'user',
          status: fallbackResult.ok ? 'success' : 'error',
          error_message: fallbackResult.ok ? null : fallbackResult.description,
          meta: {
            expires_at: access.active_until,
            days_until_expiry: 3,
            has_sbs: hasSBS,
            product_renewable: productRenewable,
            installment_mode: installmentMode,
            delivery_method: 'fallback_text',
            original_delivery: deliveryMethod,
            button_error: sendResult.description,
          },
        });

        results.push({
          user_id: access.user_id,
          club_id: access.club_id,
          sent: fallbackResult.ok,
          delivery: 'fallback_text',
          has_sbs: hasSBS,
          product_renewable: productRenewable,
          error: fallbackResult.ok ? null : fallbackResult.description,
        });
        continue;
      }

      // Mirror to admin chat (Contact Center)
      if (sendResult?.result?.message_id) {
        await logAutomatedTelegramMessage({
          supabase,
          user_id: access.user_id,
          telegram_user_id: profile.telegram_user_id,
          bot_id: club?.bot_id ?? null,
          text: message,
          telegram_message_id: sendResult.result.message_id,
          reply_markup: keyboard,
          source: 'telegram-send-reminders',
          extra_meta: {
            club_id: access.club_id,
            days_until_expiry: 3,
            delivery_method: deliveryMethod,
          },
        });
      }

      // Log the reminder
      await supabase.from('telegram_logs').insert({
        user_id: access.user_id,
        club_id: access.club_id,
        action: 'reminder_sent',
        target: 'user',
        status: 'success',
        meta: {
          expires_at: access.active_until,
          days_until_expiry: 3,
          has_sbs: hasSBS,
          product_renewable: productRenewable,
          installment_mode: installmentMode,
          delivery_method: deliveryMethod,
        },
      });

      results.push({
        user_id: access.user_id,
        club_id: access.club_id,
        sent: true,
        delivery: deliveryMethod,
        has_sbs: hasSBS,
        product_renewable: productRenewable,
      });
    }

    console.log('Reminder check completed');

    return new Response(JSON.stringify({ 
      success: true,
      processed: expiringAccess.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Send reminders error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
