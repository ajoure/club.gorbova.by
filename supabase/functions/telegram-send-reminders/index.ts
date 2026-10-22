import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateRenewalCTAs } from '../_shared/generate-renewal-ctas.ts';
import { resolveProductRenewability } from '../_shared/renewal-offer-resolver.ts';
import { greetPrefix } from '../_shared/recipient-name.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';
import { formatMinskDateTime } from '../_shared/formatMinsk.ts';
import { requireAdminSectionAccess } from '../_shared/admin-section-auth.ts';
import { resolveRenewalState, type RenewalState } from './renewal-state.ts';

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
  activeUntil: string | null,
): Promise<
  | {
      productId: string;
      productName: string;
      renewable: true;
      tariffId: string;
      amount: number;
      kind: 'recurring' | 'installment' | 'subscription_offer';
      renewalState: RenewalState;
    }
  | { productId: string; productName: string; renewable: false; reason: string }
  | { skip: true; reason: string }
  | null
> {
  const { data: product, error: productError } = await supabase
    .from('products_v2')
    .select('id, name')
    .eq('telegram_club_id', clubId)
    .eq('status', 'active')
    .maybeSingle();

  if (productError) return { skip: true, reason: 'product_lookup_failed' };
  if (!product) {
    console.log(`[tg-reminders] No product mapped to club ${clubId}`);
    return null;
  }

  const renewalState = await resolveRenewalState(supabase, userId, product.id, activeUntil);
  if (renewalState.mode === 'skip') return { skip: true, reason: renewalState.reason };
  const preferredTariffId = renewalState.tariffId ?? null;

  const r = await resolveProductRenewability(supabase, product.id, preferredTariffId);

  if (r.reason.includes('_error:')) return { skip: true, reason: 'offer_lookup_failed' };
  if (!r.renewable || !r.preferredOffer) {
    if (renewalState.mode === 'automatic') return { skip: true, reason: 'provider_product_conflict' };
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
    renewalState,
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

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (raw) body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: corsHeaders });
    }
    if (('dry_run' in body && typeof body.dry_run !== 'boolean') || ('order_id' in body && body.dry_run !== true)) {
      return new Response(JSON.stringify({ error: 'invalid_dry_run' }), { status: 400, headers: corsHeaders });
    }
    if (body.dry_run === true) {
      const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!bearer || bearer !== supabaseServiceKey) {
        const auth = await requireAdminSectionAccess(req, supabase, 'payments', 'view');
        if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
      }
      let query = supabase.from('telegram_access').select('user_id,club_id,active_until')
        .or('state_chat.eq.active,state_channel.eq.active');
      if (body.order_id !== undefined) {
        if (typeof body.order_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.order_id)) {
          return new Response(JSON.stringify({ error: 'invalid_order_id' }), { status: 400, headers: corsHeaders });
        }
        const { data: order, error } = await supabase.from('orders_v2').select('user_id,product_id').eq('id', body.order_id).maybeSingle();
        if (error || !order?.user_id || !order?.product_id) throw new Error('dry_run_order_lookup_failed');
        const { data: product, error: productError } = await supabase.from('products_v2').select('telegram_club_id').eq('id', order.product_id).maybeSingle();
        if (productError || !product?.telegram_club_id) throw new Error('dry_run_product_lookup_failed');
        query = query.eq('user_id', order.user_id).eq('club_id', product.telegram_club_id);
      } else {
        query = query.gte('active_until', new Date(Date.now() + 2 * 86400000).toISOString())
          .lte('active_until', new Date(Date.now() + 3 * 86400000).toISOString());
      }
      const { data: accesses, error } = await query.limit(101);
      if (error || !accesses || accesses.length > 100) throw new Error('dry_run_cohort_unavailable_or_over_limit');
      const counts = { automatic: 0, manual: 0, one_time: 0, skipped: 0 };
      const reasons: Record<string, number> = {};
      for (const access of accesses) {
        const resolved = await resolveProductAndTariff(supabase, access.user_id, access.club_id, access.active_until);
        const reason = !resolved ? 'product_unmapped' : 'skip' in resolved ? resolved.reason :
          resolved.renewable ? resolved.renewalState.reason : 'one_time_product';
        reasons[reason] = (reasons[reason] || 0) + 1;
        if (!resolved || 'skip' in resolved) counts.skipped++;
        else if (!resolved.renewable) counts.one_time++;
        else if (resolved.renewalState.mode === 'automatic') counts.automatic++;
        else counts.manual++;
      }
      return new Response(JSON.stringify({ success: true, dry_run: true, version: 'tg-renewal-provider-state-v1',
        processed: accesses.length, counts, reasons, sent: 0, writes: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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

      // PATCH MINSK-TIME v1: точный формат "3 мая в 23:59 (Минск)" + строка списания
      const expiryDate = new Date(access.active_until!);
      const formattedDate = formatMinskDateTime(expiryDate) || '';

      const resolved = await resolveProductAndTariff(supabase, access.user_id, access.club_id, access.active_until);
      if (!resolved || 'skip' in resolved) {
        results.push({ skipped: true, reason: resolved && 'skip' in resolved ? resolved.reason : 'product_unmapped' });
        continue;
      }
      // The status and date come from the SAME exact provider/subscription relation.
      const nextChargeAt = resolved.renewable ? resolved.renewalState.nextChargeAt : null;
      const nextChargeLine = nextChargeAt ? `\n\n⚡ Следующее списание запланировано: ${formatMinskDateTime(nextChargeAt)}` : '';

      const clubName = club.club_name || 'клубе';

      // hasSBS = у пользователя уже активна провайдерская подписка (автосписание)
      const hasSBS = !!resolved && resolved.renewable === true && resolved.renewalState.mode === 'automatic';
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
        message = `⏰ Небольшое напоминание\n\n${namePrefix}автопродление подписки в ${clubName} включено.${nextChargeLine}\n\nДоступ оплачен до ${formattedDate}. Отключить автопродление можно в личном кабинете 💙`;
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
