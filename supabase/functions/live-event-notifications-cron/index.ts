import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationOffset {
  minutes: number;
  enabled: boolean;
  label: string;
}

interface NotificationSettings {
  enabled: boolean;
  template_id: string | null;
  channels: string[];
  offsets: NotificationOffset[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    // 1. Find published live_stream events with notifications enabled and scheduled_at in the future or recent past
    const { data: events, error: eventsError } = await supabase
      .from('live_events')
      .select('id, slug, title, description, scheduled_at, event_timezone, event_type, platform_status, metadata')
      .eq('is_published', true)
      .eq('event_type', 'live_stream')
      .not('scheduled_at', 'is', null)
      .in('platform_status', ['draft', 'scheduled', 'live']);

    if (eventsError) {
      console.error('[live-notif-cron] Error fetching events:', eventsError);
      return jsonRes({ error: 'Failed to fetch events' }, 500);
    }

    if (!events || events.length === 0) {
      return jsonRes({ ok: true, message: 'No eligible events', sent: 0 });
    }

    for (const event of events) {
      const meta = event.metadata as Record<string, any> | null;
      const ns = meta?.notification_settings as NotificationSettings | null;

      if (!ns?.enabled || !ns.template_id || !ns.channels?.length) continue;
      if (!event.scheduled_at) continue;

      const scheduledAt = new Date(event.scheduled_at);

      // Check each enabled offset
      for (const offset of ns.offsets) {
        if (!offset.enabled) continue;

        const windowStart = new Date(scheduledAt.getTime() - offset.minutes * 60 * 1000);
        
        // Only send if we're past the window start and before the event
        if (now < windowStart || now > scheduledAt) continue;

        // 2. Get template
        const { data: template } = await supabase
          .from('broadcast_templates')
          .select('id, message_text, email_subject, email_body_html, button_text, button_url')
          .eq('id', ns.template_id)
          .single();

        if (!template) {
          console.warn(`[live-notif-cron] Template ${ns.template_id} not found for event ${event.id}`);
          continue;
        }

        // 3. Get audience via access rules
        const { data: accessRules } = await supabase
          .from('live_event_access_rules')
          .select('product_id, tariff_id')
          .eq('live_event_id', event.id);

        if (!accessRules || accessRules.length === 0) continue;

        // Get users with active subscriptions or entitlements for these products
        const productIds = [...new Set(accessRules.map(r => r.product_id))];
        
        const userIds = new Set<string>();
        
        // From subscriptions_v2
        for (const productId of productIds) {
          const { data: subs } = await supabase
            .from('subscriptions_v2')
            .select('user_id')
            .eq('product_id', productId)
            .in('status', ['active', 'trial']);
          
          subs?.forEach(s => userIds.add(s.user_id));
        }

        // From entitlements
        for (const productId of productIds) {
          const { data: ents } = await supabase
            .from('entitlements')
            .select('user_id')
            .eq('product_id', productId)
            .eq('status', 'active');
          
          ents?.forEach(e => userIds.add(e.user_id));
        }

        if (userIds.size === 0) continue;

        // 4. Prepare template variables
        const siteUrl = Deno.env.get('SITE_URL') || 'https://gorbova.lovable.app';
        const eventLink = `${siteUrl}/live/${event.slug}`;
        const eventTypeLabel = event.event_type === 'live_stream' ? 'Живой эфир' : 'Эфир в записи';

        const scheduledAtSourceTz = formatDateInTz(scheduledAt, event.event_timezone || 'Europe/Minsk');

        const replaceTokens = (text: string, userTz?: string): string => {
          let result = text;
          result = result.replace(/\{\{live_event\.title\}\}/g, event.title || '');
          result = result.replace(/\{\{live_event\.description\}\}/g, event.description || '');
          result = result.replace(/\{\{live_event\.start_at_source_tz\}\}/g, scheduledAtSourceTz);
          result = result.replace(/\{\{live_event\.start_at_user_tz\}\}/g, 
            userTz ? formatDateInTz(scheduledAt, userTz) : scheduledAtSourceTz);
          result = result.replace(/\{\{live_event\.link\}\}/g, eventLink);
          result = result.replace(/\{\{live_event\.type\}\}/g, eventTypeLabel);
          return result;
        };

        // 5. Send to each user
        for (const userId of userIds) {
          for (const channel of ns.channels) {
            // Check dedup via UNIQUE constraint
            const { error: insertError } = await supabase
              .from('live_event_notification_log')
              .insert({
                live_event_id: event.id,
                template_id: ns.template_id,
                user_id: userId,
                channel,
                notify_offset_minutes: offset.minutes,
                scheduled_for: windowStart.toISOString(),
                status: 'pending',
              });

            if (insertError) {
              // unique_violation = already sent
              if (insertError.code === '23505') {
                totalSkipped++;
                continue;
              }
              console.error(`[live-notif-cron] Insert error:`, insertError);
              totalFailed++;
              continue;
            }

            // Get user profile for sending
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, email, telegram_chat_id, timezone, first_name')
              .eq('user_id', userId)
              .single();

            if (!profile) {
              await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'No profile found');
              totalSkipped++;
              continue;
            }

            const userTz = profile.timezone || event.event_timezone || 'Europe/Minsk';

            try {
              if (channel === 'telegram' && profile.telegram_chat_id) {
                const messageText = replaceTokens(template.message_text || event.title, userTz);
                
                // Get first active bot
                const { data: bot } = await supabase
                  .from('telegram_bots')
                  .select('bot_token')
                  .eq('is_active', true)
                  .limit(1)
                  .single();

                if (bot?.bot_token) {
                  const keyboard = template.button_text ? {
                    inline_keyboard: [[{
                      text: replaceTokens(template.button_text, userTz),
                      url: replaceTokens(template.button_url || eventLink, userTz),
                    }]],
                  } : undefined;

                  const response = await fetch(`https://api.telegram.org/bot${bot.bot_token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: profile.telegram_chat_id,
                      text: messageText,
                      parse_mode: 'Markdown',
                      reply_markup: keyboard,
                    }),
                  });

                  const result = await response.json();
                  if (result.ok) {
                    await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'sent');
                    totalSent++;
                  } else {
                    await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'failed', JSON.stringify(result));
                    totalFailed++;
                  }
                } else {
                  await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'No active bot');
                  totalSkipped++;
                }
              } else if (channel === 'email' && profile.email) {
                const subject = replaceTokens(template.email_subject || `${event.title} — напоминание`, userTz);
                const html = replaceTokens(template.email_body_html || template.message_text || event.title, userTz);

                await supabase.functions.invoke('send-email', {
                  body: {
                    to: profile.email,
                    subject,
                    html,
                    context: {
                      user_id: userId,
                      event_type: 'live_event_notification',
                      meta: { live_event_id: event.id, offset_minutes: offset.minutes },
                    },
                  },
                });

                await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'sent');
                totalSent++;
              } else {
                await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 
                  `No ${channel} contact`);
                totalSkipped++;
              }
            } catch (sendErr) {
              console.error(`[live-notif-cron] Send error for ${userId}/${channel}:`, sendErr);
              await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'failed', 
                sendErr instanceof Error ? sendErr.message : String(sendErr));
              totalFailed++;
            }
          }
        }
      }
    }

    return jsonRes({ ok: true, sent: totalSent, skipped: totalSkipped, failed: totalFailed });
  } catch (err) {
    console.error('[live-notif-cron] Unexpected error:', err);
    return jsonRes({ error: 'Internal error' }, 500);
  }
});

async function updateLogStatus(
  supabase: any,
  eventId: string,
  userId: string,
  channel: string,
  offsetMinutes: number,
  status: string,
  error?: string,
) {
  await supabase
    .from('live_event_notification_log')
    .update({
      status,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      error: error || null,
    })
    .eq('live_event_id', eventId)
    .eq('user_id', userId)
    .eq('channel', channel)
    .eq('notify_offset_minutes', offsetMinutes);
}

function formatDateInTz(date: Date, tz: string): string {
  try {
    return date.toLocaleString('ru-RU', {
      timeZone: tz,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
