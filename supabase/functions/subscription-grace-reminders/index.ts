import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Format currency helper
function formatCurrency(amount: number, currency: string = 'BYN'): string {
  return `${amount.toFixed(2)} ${currency}`;
}

// Format date in Russian
function formatDateRu(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Calculate hours remaining
function getHoursRemaining(graceEndsAt: Date): number {
  return Math.max(0, Math.floor((graceEndsAt.getTime() - Date.now()) / (1000 * 60 * 60)));
}

// Check idempotency via grace_notification_events table
async function wasEventSent(
  supabase: any,
  subscriptionId: string,
  eventType: string
): Promise<boolean> {
  const { data } = await supabase
    .from('grace_notification_events')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .eq('event_type', eventType)
    .limit(1)
    .maybeSingle();

  return !!data;
}

// Record event sent
async function recordEventSent(
  supabase: any,
  subscriptionId: string,
  eventType: string,
  channel: string,
  meta: Record<string, any> = {}
): Promise<void> {
  await supabase.from('grace_notification_events').insert({
    subscription_id: subscriptionId,
    event_type: eventType,
    channel,
    meta,
  });
}

// Send grace notification via Telegram and Email
async function sendGraceNotification(
  supabase: any,
  userId: string,
  subscriptionId: string,
  eventType: 'grace_started' | 'grace_24h_left' | 'grace_48h_left' | 'grace_expired',
  graceEndsAt: Date | null,
  amount: number,
  currency: string
): Promise<{ telegram: boolean; email: boolean }> {
  const result = { telegram: false, email: false };

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('telegram_user_id, telegram_link_status, full_name, email')
    .eq('user_id', userId)
    .single();

  if (!profile) {
    console.log(`No profile for user ${userId}`);
    return result;
  }

  const userName = profile.full_name?.split(' ')[0] || 'Клиент';
  const hoursLeft = graceEndsAt ? getHoursRemaining(graceEndsAt) : 0;

  // Message templates
  const messages: Record<string, string> = {
    grace_started: `⚠️ *Не удалось продлить подписку*

${userName}, платёж за продление не прошёл.

📦 *Продукт:* Gorbova Club
💳 *Сумма:* ${formatCurrency(amount, currency)}

*У вас есть 72 часа*, чтобы оплатить и сохранить текущую цену.

После ${graceEndsAt ? formatDateRu(graceEndsAt) : 'истечения срока'} стоимость повторного вступления будет выше.

⏰ Осталось: 72 часа

🔗 [Оплатить сейчас](https://club.gorbova.by/pricing)
🔗 [Привязать карту](https://club.gorbova.by/settings/payment-methods)`,

    grace_24h_left: `⏳ *Осталось 48 часов*

${userName}, напоминание: у вас осталось 48 часов, чтобы вернуться в клуб по прежней цене.

После ${graceEndsAt ? formatDateRu(graceEndsAt) : 'дедлайна'} цена будет выше.

🔗 [Оплатить](https://club.gorbova.by/pricing)`,

    grace_48h_left: `⏰ *Последние 24 часа!*

${userName}, осталось меньше суток до повышения цены.

Если хотите сохранить прежнюю стоимость — оплатите сегодня.

🔗 [Вернуться по старой цене](https://club.gorbova.by/pricing)`,

    grace_expired: `❌ *Время для возврата истекло*

${userName}, 72 часа прошли — прежняя цена больше недоступна.

Вернуться в клуб можно только вручную по текущей цене:
🔗 [Посмотреть тарифы](https://club.gorbova.by/pricing)`,
  };

  const text = messages[eventType];
  if (!text) return result;

  // Send Telegram if linked
  if (profile.telegram_user_id && profile.telegram_link_status === 'active') {
    try {
      const { data: linkBot } = await supabase
        .from('telegram_bots')
        .select('token')
        .eq('is_link_bot', true)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (linkBot?.token) {
        const tgResponse = await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: profile.telegram_user_id,
            text,
            parse_mode: 'Markdown',
          }),
        });

        if (tgResponse.ok) {
          result.telegram = true;
          
          // Log to telegram_logs
          await supabase.from('telegram_logs').insert({
            user_id: userId,
            action: 'grace_notification',
            event_type: eventType,
            status: 'success',
            meta: { subscription_id: subscriptionId, hours_left: hoursLeft },
          });
        }
      }
    } catch (err) {
      console.error(`Failed to send Telegram for ${eventType}:`, err);
    }
  }

  // Send Email
  if (profile.email) {
    const subjects: Record<string, string> = {
      grace_started: '72 часа, чтобы вернуться по прежней цене',
      grace_24h_left: 'Осталось 48 часов сохранить прежнюю цену',
      grace_48h_left: 'Последние 24 часа: прежняя цена скоро закончится',
      grace_expired: 'Срок возврата по прежней цене истёк',
    };

    try {
      await supabase.functions.invoke('send-email', {
        body: {
          to: profile.email,
          subject: subjects[eventType],
          html: text.replace(/\n/g, '<br>').replace(/\*([^*]+)\*/g, '<strong>$1</strong>'),
          context: { user_id: userId, subscription_id: subscriptionId, event_type: eventType },
        },
      });
      result.email = true;
    } catch (err) {
      console.error(`Failed to send Email for ${eventType}:`, err);
    }
  }

  // Record event sent if at least one channel worked
  if (result.telegram || result.email) {
    await recordEventSent(supabase, subscriptionId, eventType, result.telegram ? 'telegram' : 'email', {
      telegram_sent: result.telegram,
      email_sent: result.email,
      hours_left: hoursLeft,
    });
  }

  return result;
}

// Mark subscription as expired_reentry
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

  // 3. Audit log
  await supabase.from('audit_logs').insert({
    action: 'subscription.grace_expired',
    actor_type: 'system',
    actor_label: 'subscription-grace-reminders',
    target_user_id: userId,
    meta: { subscription_id: subId },
  });

  console.log(`Subscription ${subId}: marked as expired_reentry, was_club_member=true`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const nowIso = now.toISOString();

    const results = {
      grace_started: 0,
      grace_24h_left: 0,
      grace_48h_left: 0,
      grace_expired: 0,
      total_processed: 0,
      errors: [] as string[],
    };

    // STOP guards - limits per step and total
    const MAX_PER_STEP = 50;
    const MAX_TOTAL = 500;

    // ========== STEP 1: Start grace for newly expired subscriptions ==========
    // Grace starts DETERMINISTICALLY from access_end_at, not from "first charge attempt"
    const { data: newlyExpired } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, access_end_at, meta, tariff_id')
      .lt('access_end_at', nowIso)
      .is('grace_period_started_at', null)
      .in('status', ['active', 'past_due'])
      .eq('auto_renew', true)
      .limit(MAX_PER_STEP);

    // STOP guard: check for anomaly
    if ((newlyExpired?.length || 0) >= MAX_PER_STEP) {
      // Check total count for anomaly detection
      const { count: totalNewlyExpired } = await supabase
        .from('subscriptions_v2')
        .select('id', { count: 'exact', head: true })
        .lt('access_end_at', nowIso)
        .is('grace_period_started_at', null)
        .in('status', ['active', 'past_due'])
        .eq('auto_renew', true);
      
      if ((totalNewlyExpired || 0) > MAX_TOTAL) {
        console.error(`ANOMALY: Too many newly expired subscriptions (${totalNewlyExpired})`);
        await supabase.from('audit_logs').insert({
          action: 'subscription.grace_reminders_anomaly',
          actor_type: 'system',
          actor_label: 'subscription-grace-reminders',
          meta: { reason: 'too_many_newly_expired', count: totalNewlyExpired, threshold: MAX_TOTAL },
        });
        return new Response(JSON.stringify({ error: 'Anomaly detected', count: totalNewlyExpired }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    for (const sub of newlyExpired || []) {
      try {
        // Get grace_hours from recurring_snapshot or default 72
        const subMeta = (sub.meta || {}) as Record<string, any>;
        const recurringSnapshot = subMeta.recurring_snapshot || {};
        const graceHours = recurringSnapshot.grace_hours || 72;

        // DETERMINISTIC: grace_period_started_at = access_end_at
        const accessEndAt = new Date(sub.access_end_at);
        const graceEndsAt = new Date(accessEndAt.getTime() + graceHours * 60 * 60 * 1000);

        console.log(`Subscription ${sub.id}: starting grace, access_end_at=${sub.access_end_at}, grace_ends_at=${graceEndsAt.toISOString()}`);

        await supabase.from('subscriptions_v2').update({
          grace_period_started_at: accessEndAt.toISOString(),
          grace_period_ends_at: graceEndsAt.toISOString(),
          grace_period_status: 'in_grace',
          updated_at: nowIso,
        }).eq('id', sub.id);

        // Get amount from last order or tariff
        let amount = 0;
        let currency = 'BYN';
        
        const { data: lastOrder } = await supabase
          .from('orders_v2')
          .select('final_price, currency')
          .eq('user_id', sub.user_id)
          .eq('status', 'paid')
          .order('paid_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastOrder?.final_price) {
          amount = Number(lastOrder.final_price);
          currency = lastOrder.currency || 'BYN';
        } else {
          // Fallback to tariff
          const { data: tariff } = await supabase
            .from('tariffs')
            .select('original_price')
            .eq('id', sub.tariff_id)
            .single();
          amount = tariff?.original_price || 0;
        }

        // Send grace_started notification
        const sent = await sendGraceNotification(supabase, sub.user_id, sub.id, 'grace_started', graceEndsAt, amount, currency);
        if (sent.telegram || sent.email) results.grace_started++;
        results.total_processed++;
      } catch (err) {
        console.error(`Error starting grace for ${sub.id}:`, err);
        results.errors.push(`start:${sub.id}:${err}`);
      }
    }

    // STOP guard: check total processed
    if (results.total_processed >= MAX_TOTAL) {
      console.log(`STOP: Reached MAX_TOTAL (${MAX_TOTAL}) after step 1`);
      await logAndReturn();
    }

    // Helper to log and return early
    async function logAndReturn() {
      await supabase.from('audit_logs').insert({
        action: 'subscription.grace_reminders_cron_completed',
        actor_type: 'system',
        actor_label: 'subscription-grace-reminders',
        meta: { run_at: nowIso, early_exit: true, ...results },
      });
    }

    // ========== STEP 2: Send 24h reminder (48h remaining) ==========
    if (results.total_processed < MAX_TOTAL) {
      const hour24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const { data: day2Subs } = await supabase
        .from('subscriptions_v2')
        .select('id, user_id, grace_period_ends_at, meta')
        .eq('grace_period_status', 'in_grace')
        .lt('grace_period_started_at', hour24ago.toISOString())
        .gt('grace_period_ends_at', nowIso)
        .limit(MAX_PER_STEP);

      for (const sub of day2Subs || []) {
        if (results.total_processed >= MAX_TOTAL) break;
        if (await wasEventSent(supabase, sub.id, 'grace_24h_left')) continue;

        try {
          const graceEndsAt = new Date(sub.grace_period_ends_at);
          const sent = await sendGraceNotification(supabase, sub.user_id, sub.id, 'grace_24h_left', graceEndsAt, 0, 'BYN');
          if (sent.telegram || sent.email) results.grace_24h_left++;
          results.total_processed++;
        } catch (err) {
          console.error(`Error sending 24h reminder for ${sub.id}:`, err);
          results.errors.push(`24h:${sub.id}:${err}`);
        }
      }
    }

    // ========== STEP 3: Send 48h reminder (24h remaining) ==========
    if (results.total_processed < MAX_TOTAL) {
      const hour48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const { data: day3Subs } = await supabase
        .from('subscriptions_v2')
        .select('id, user_id, grace_period_ends_at, meta')
        .eq('grace_period_status', 'in_grace')
        .lt('grace_period_started_at', hour48ago.toISOString())
        .gt('grace_period_ends_at', nowIso)
        .limit(MAX_PER_STEP);

      for (const sub of day3Subs || []) {
        if (results.total_processed >= MAX_TOTAL) break;
        if (await wasEventSent(supabase, sub.id, 'grace_48h_left')) continue;

        try {
          const graceEndsAt = new Date(sub.grace_period_ends_at);
          const sent = await sendGraceNotification(supabase, sub.user_id, sub.id, 'grace_48h_left', graceEndsAt, 0, 'BYN');
          if (sent.telegram || sent.email) results.grace_48h_left++;
          results.total_processed++;
        } catch (err) {
          console.error(`Error sending 48h reminder for ${sub.id}:`, err);
          results.errors.push(`48h:${sub.id}:${err}`);
        }
      }
    }

    // ========== STEP 4: Mark expired grace as expired_reentry ==========
    let expiredGrace: any[] = [];
    if (results.total_processed < MAX_TOTAL) {
      const { data } = await supabase
        .from('subscriptions_v2')
        .select('id, user_id, meta')
        .eq('grace_period_status', 'in_grace')
        .lte('grace_period_ends_at', nowIso)
        .limit(MAX_PER_STEP);
      expiredGrace = data || [];
    }

    for (const sub of expiredGrace) {
      if (results.total_processed >= MAX_TOTAL) break;
      try {
        const subMeta = (sub.meta || {}) as Record<string, any>;
        await markAsExpiredReentry(supabase, sub.user_id, sub.id, subMeta);

        // Send grace_expired notification
        if (!(await wasEventSent(supabase, sub.id, 'grace_expired'))) {
          const sent = await sendGraceNotification(supabase, sub.user_id, sub.id, 'grace_expired', null, 0, 'BYN');
          if (sent.telegram || sent.email) results.grace_expired++;
        }
        results.total_processed++;
      } catch (err) {
        console.error(`Error expiring grace for ${sub.id}:`, err);
        results.errors.push(`expire:${sub.id}:${err}`);
      }
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'subscription.grace_reminders_cron_completed',
      actor_type: 'system',
      actor_label: 'subscription-grace-reminders',
      meta: {
        run_at: nowIso,
        ...results,
      },
    });

    console.log('Grace reminders completed:', results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Grace reminders error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
