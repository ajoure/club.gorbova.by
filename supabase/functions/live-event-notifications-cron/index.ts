import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';

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
  let eventsNoAudience = 0;
  let eventsSourceNotReady = 0;

  try {
    // 1. Find published live_stream events with notifications enabled
    // IMPORTANT: only event_type = 'live_stream', recorded_webinar NEVER participates
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
      return jsonRes({ ok: true, message: 'No eligible events', sent: 0, skipped: 0, failed: 0, no_audience: 0, source_not_ready: 0 });
    }

    for (const event of events) {
      const meta = event.metadata as Record<string, any> | null;
      const ns = meta?.notification_settings as NotificationSettings | null;

      if (!ns?.enabled || !ns.template_id || !ns.channels?.length) continue;
      if (!event.scheduled_at) continue;

      // 6C. Stop-guard: source not ready (only for live_stream)
      const providerStatus = meta?.provider_source_status;
      if (providerStatus === 'missing' || providerStatus === 'broken') {
        console.log(`[live-notif-cron] Event ${event.id}: source_not_ready (${providerStatus}) — skipping`);
        eventsSourceNotReady++;
        continue;
      }

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

        // 6A. Canonical audience via resolveEffectiveProductAccess
        const { data: accessRules } = await supabase
          .from('live_event_access_rules')
          .select('product_id, tariff_id')
          .eq('live_event_id', event.id);

        if (!accessRules || accessRules.length === 0) continue;

        const productIds = [...new Set(accessRules.map(r => r.product_id))];
        
        // Collect candidate users from subscriptions + entitlements
        const candidateUserIds = new Set<string>();
        
        for (const productId of productIds) {
          const { data: subs } = await supabase
            .from('subscriptions_v2')
            .select('user_id')
            .eq('product_id', productId)
            .in('status', ['active', 'trial']);
          subs?.forEach(s => candidateUserIds.add(s.user_id));

          const { data: ents } = await supabase
            .from('entitlements')
            .select('user_id')
            .eq('product_id', productId)
            .eq('status', 'active');
          ents?.forEach(e => candidateUserIds.add(e.user_id));
        }

        // Verify each candidate with canonical resolver + tariff_id filter
        const verifiedUserIds = new Set<string>();
        for (const userId of candidateUserIds) {
          for (const rule of accessRules) {
            const snapshot = await resolveEffectiveProductAccess(supabase, userId, rule.product_id, now);
            const hasAccess = snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > now);
            
            if (!hasAccess) continue;

            // Check tariff_id if specified in rule
            if (rule.tariff_id) {
              const { data: tariffSub } = await supabase
                .from('subscriptions_v2')
                .select('id')
                .eq('user_id', userId)
                .eq('product_id', rule.product_id)
                .eq('tariff_id', rule.tariff_id)
                .in('status', ['active', 'trial'])
                .limit(1)
                .maybeSingle();
              if (!tariffSub) continue;
            }

            verifiedUserIds.add(userId);
            break;
          }
        }

        // 6B. Stop-guard: empty audience
        if (verifiedUserIds.size === 0) {
          console.log(`[live-notif-cron] Event ${event.id}, offset ${offset.minutes}min: no_audience (candidates=${candidateUserIds.size}, verified=0) — skipping`);
          eventsNoAudience++;
          continue;
        }

        console.log(`[live-notif-cron] Event ${event.id}, offset ${offset.minutes}min: audience verified (${verifiedUserIds.size}/${candidateUserIds.size}), template=${ns.template_id}, channels=${ns.channels.join(',')}`);

        // 4. Prepare template variables
        const siteUrl = Deno.env.get('SITE_URL') || 'https://gorbova.lovable.app';
        const eventLink = `${siteUrl}/live/${event.slug}`;
        const eventTypeLabel = 'Живой эфир';

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

        // 5. Send to each verified user
        for (const userId of verifiedUserIds) {
          for (const channel of ns.channels) {
            // 6D. Template/channel compatibility validation
            if (channel === 'telegram' && !template.message_text) {
              // Log incompatibility with specific reason
              const { error: insertErr } = await supabase
                .from('live_event_notification_log')
                .insert({
                  live_event_id: event.id,
                  template_id: ns.template_id,
                  user_id: userId,
                  channel,
                  notify_offset_minutes: offset.minutes,
                  scheduled_for: windowStart.toISOString(),
                  status: 'skipped',
                  error: 'template_incompatible_with_telegram',
                });
              if (!insertErr) totalSkipped++;
              else if (insertErr.code === '23505') totalSkipped++;
              else totalFailed++;
              continue;
            }

            if (channel === 'email' && (!template.email_subject || !template.email_body_html)) {
              const { error: insertErr } = await supabase
                .from('live_event_notification_log')
                .insert({
                  live_event_id: event.id,
                  template_id: ns.template_id,
                  user_id: userId,
                  channel,
                  notify_offset_minutes: offset.minutes,
                  scheduled_for: windowStart.toISOString(),
                  status: 'skipped',
                  error: 'template_incompatible_with_email',
                });
              if (!insertErr) totalSkipped++;
              else if (insertErr.code === '23505') totalSkipped++;
              else totalFailed++;
              continue;
            }

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
              .select('id, email, telegram_user_id, timezone, first_name')
              .eq('user_id', userId)
              .single();

            if (!profile) {
              await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'no_profile');
              totalSkipped++;
              continue;
            }

            const userTz = profile.timezone || event.event_timezone || 'Europe/Minsk';

            try {
              if (channel === 'telegram' && profile.telegram_user_id) {
                const messageText = replaceTokens(template.message_text!, userTz);
                
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
                      chat_id: profile.telegram_user_id,
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
                  await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'no_active_bot');
                  totalSkipped++;
                }
              } else if (channel === 'email' && profile.email) {
                const subject = replaceTokens(template.email_subject!, userTz);
                const html = replaceTokens(template.email_body_html!, userTz);

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
                  `no_${channel}_contact`);
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

    return jsonRes({ 
      ok: true, 
      sent: totalSent, 
      skipped: totalSkipped, 
      failed: totalFailed, 
      no_audience: eventsNoAudience, 
      source_not_ready: eventsSourceNotReady,
    });
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
