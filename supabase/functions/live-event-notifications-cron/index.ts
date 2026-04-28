import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';
import { logAutomatedTelegramMessage } from '../_shared/log-automated-telegram.ts';

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

interface CronRequest {
  dry_run?: boolean;
  force_event_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Parse request body for dry_run flag
  let body: CronRequest = {};
  try {
    body = await req.json();
  } catch { /* empty body ok for cron */ }

  const isDryRun = body.dry_run === true;

  const now = new Date();
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let eventsNoAudience = 0;
  let eventsSourceNotReady = 0;
  const dryRunPreview: any[] = [];

  try {
    // ====== GUARDRAIL 1: Global kill-switch ======
    const { data: config } = await supabase
      .from('live_notification_config')
      .select('enabled, proof_mode, production_approved, test_allowlist')
      .eq('id', 1)
      .single();

    if (!config?.enabled) {
      console.log('[live-notif-cron] Global kill-switch is OFF — controlled skip');
      return jsonRes({
        ok: true,
        controlled_skip: true,
        reason: 'global_kill_switch_disabled',
        sent: 0, skipped: 0, failed: 0, no_audience: 0, source_not_ready: 0,
      });
    }

    // ====== GUARDRAIL 2: Production approval gate ======
    if (!isDryRun && !config.production_approved) {
      console.log('[live-notif-cron] Production not approved — only dry_run allowed');
      return jsonRes({
        ok: true,
        controlled_skip: true,
        reason: 'production_not_approved',
        hint: 'Set production_approved=true in live_notification_config or use dry_run=true',
        sent: 0, skipped: 0, failed: 0, no_audience: 0, source_not_ready: 0,
      });
    }

    const isProofMode = config.proof_mode === true;
    const testAllowlist = config.test_allowlist || [];
    const dispatchMode = isDryRun ? 'dry_run' : (isProofMode ? 'proof' : 'production');

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
      return jsonRes({ ok: true, message: 'No eligible events', dry_run: isDryRun, sent: 0, skipped: 0, failed: 0, no_audience: 0, source_not_ready: 0 });
    }

    for (const event of events) {
      const meta = event.metadata as Record<string, any> | null;
      const ns = meta?.notification_settings as NotificationSettings | null;

      if (!ns?.enabled || !ns.template_id || !ns.channels?.length) continue;
      if (!event.scheduled_at) continue;

      // ====== STOP-GUARD: Template/channel compatibility pre-check ======
      // If ALL channels are incompatible with the template, skip the entire event
      const { data: templateCheck } = await supabase
        .from('broadcast_templates')
        .select('id, message_text, email_subject, email_body_html, button_text, button_url')
        .eq('id', ns.template_id)
        .single();

      if (!templateCheck) {
        console.warn(`[live-notif-cron] Template ${ns.template_id} not found for event ${event.id}`);
        continue;
      }

      const compatibleChannels = ns.channels.filter(ch => {
        if (ch === 'telegram') return !!templateCheck.message_text;
        if (ch === 'email') return !!templateCheck.email_subject && !!templateCheck.email_body_html;
        return false;
      });

      if (compatibleChannels.length === 0) {
        console.warn(`[live-notif-cron] Event ${event.id}: ALL channels incompatible with template — event not_ready`);
        totalSkipped++;
        continue;
      }

      // Stop-guard: source not ready (only for live_stream)
      const providerStatus = meta?.provider_source_status;
      if (providerStatus === 'missing' || providerStatus === 'broken') {
        console.log(`[live-notif-cron] Event ${event.id}: source_not_ready (${providerStatus}) — skipping`);
        eventsSourceNotReady++;
        continue;
      }

      const scheduledAt = new Date(event.scheduled_at);

      for (const offset of ns.offsets) {
        if (!offset.enabled) continue;

        const windowStart = new Date(scheduledAt.getTime() - offset.minutes * 60 * 1000);
        if (now < windowStart || now > scheduledAt) continue;

        // Canonical audience via resolveEffectiveProductAccess
        const { data: accessRules } = await supabase
          .from('live_event_access_rules')
          .select('product_id, tariff_id')
          .eq('live_event_id', event.id);

        if (!accessRules || accessRules.length === 0) continue;

        const productIds = [...new Set(accessRules.map(r => r.product_id))];
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

        const verifiedUserIds = new Set<string>();
        for (const userId of candidateUserIds) {
          for (const rule of accessRules) {
            const snapshot = await resolveEffectiveProductAccess(supabase, userId, rule.product_id, now);
            const hasAccess = snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > now);
            if (!hasAccess) continue;

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

        if (verifiedUserIds.size === 0) {
          console.log(`[live-notif-cron] Event ${event.id}, offset ${offset.minutes}min: no_audience`);
          eventsNoAudience++;
          continue;
        }

        // ====== GUARDRAIL 3: Proof mode — filter to allowlist ======
        let targetUserIds = verifiedUserIds;
        if (isProofMode && !isDryRun) {
          const allowSet = new Set(testAllowlist.map(String));
          const filtered = new Set<string>();
          for (const uid of verifiedUserIds) {
            if (allowSet.has(uid)) filtered.add(uid);
          }
          if (filtered.size === 0) {
            console.log(`[live-notif-cron] Proof mode: no users in allowlist — skipping send`);
            if (isDryRun) {
              // still show preview
            } else {
              totalSkipped += verifiedUserIds.size;
              continue;
            }
          }
          targetUserIds = filtered;
        }

        console.log(`[live-notif-cron] Event ${event.id}, offset ${offset.minutes}min: audience=${targetUserIds.size} (total verified=${verifiedUserIds.size}), mode=${dispatchMode}`);

        // Prepare template variables
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

        // ====== DRY-RUN: collect preview, skip send ======
        if (isDryRun) {
          for (const userId of targetUserIds) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, email, telegram_user_id, timezone, first_name, last_name')
              .eq('user_id', userId)
              .single();

            const userTz = profile?.timezone || event.event_timezone || 'Europe/Minsk';
            
            for (const channel of compatibleChannels) {
              const preview: any = {
                event_id: event.id,
                user_id: userId,
                user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'no_profile',
                email: profile?.email,
                telegram_user_id: profile?.telegram_user_id,
                channel,
                offset_minutes: offset.minutes,
                dispatch_mode: 'dry_run',
              };

              if (channel === 'telegram') {
                preview.rendered_text = replaceTokens(templateCheck.message_text!, userTz);
                preview.rendered_button_text = templateCheck.button_text ? replaceTokens(templateCheck.button_text, userTz) : null;
                preview.rendered_button_url = templateCheck.button_url ? replaceTokens(templateCheck.button_url, userTz) : eventLink;
              } else if (channel === 'email') {
                preview.rendered_subject = replaceTokens(templateCheck.email_subject!, userTz);
                preview.rendered_text = replaceTokens(templateCheck.email_body_html!, userTz);
              }

              dryRunPreview.push(preview);
            }
          }
          continue; // skip actual send in dry_run
        }

        // ====== ACTUAL SEND ======
        for (const userId of targetUserIds) {
          for (const channel of compatibleChannels) {
            // Dedup via UNIQUE constraint
            const { data: profile } = await supabase
              .from('profiles')
              .select('id, email, telegram_user_id, timezone, first_name, last_name')
              .eq('user_id', userId)
              .single();

            const userTz = profile?.timezone || event.event_timezone || 'Europe/Minsk';

            // Pre-render payload for snapshot
            let renderedSubject: string | null = null;
            let renderedText: string | null = null;
            let renderedButtonText: string | null = null;
            let renderedButtonUrl: string | null = null;

            if (channel === 'telegram') {
              renderedText = replaceTokens(templateCheck.message_text!, userTz);
              renderedButtonText = templateCheck.button_text ? replaceTokens(templateCheck.button_text, userTz) : null;
              renderedButtonUrl = templateCheck.button_url ? replaceTokens(templateCheck.button_url, userTz) : eventLink;
            } else if (channel === 'email') {
              renderedSubject = replaceTokens(templateCheck.email_subject!, userTz);
              renderedText = replaceTokens(templateCheck.email_body_html!, userTz);
            }

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
                dispatch_mode: dispatchMode,
                rendered_subject: renderedSubject,
                rendered_text: renderedText,
                rendered_button_text: renderedButtonText,
                rendered_button_url: renderedButtonUrl,
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

            if (!profile) {
              await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'no_profile');
              totalSkipped++;
              continue;
            }

            try {
              if (channel === 'telegram' && profile.telegram_user_id) {
                const club = await getActiveBot(supabase);
                const botToken = club?.botToken;

                if (botToken) {
                  const keyboard = renderedButtonText ? {
                    inline_keyboard: [[{
                      text: renderedButtonText,
                      url: renderedButtonUrl || eventLink,
                    }]],
                  } : undefined;

                  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: profile.telegram_user_id,
                      text: renderedText,
                      parse_mode: 'Markdown',
                      reply_markup: keyboard,
                    }),
                  });

                  const result = await response.json();
                  if (result.ok) {
                    // Mirror to admin chat (Contact Center)
                    if (keyboard && result?.result?.message_id) {
                      await logAutomatedTelegramMessage({
                        supabase,
                        user_id: userId,
                        telegram_user_id: profile.telegram_user_id,
                        bot_id: club?.botId ?? null,
                        text: renderedText,
                        telegram_message_id: result.result.message_id,
                        reply_markup: keyboard,
                        source: 'live-event-notifications-cron',
                        extra_meta: {
                          live_event_id: event.id,
                          notify_offset_minutes: offset.minutes,
                        },
                      });
                    }
                    await updateLogStatusFull(supabase, event.id, userId, channel, offset.minutes, 'sent', null, 
                      String(result.result?.message_id || ''), result);
                    totalSent++;
                  } else {
                    await updateLogStatusFull(supabase, event.id, userId, channel, offset.minutes, 'failed', 
                      JSON.stringify(result), null, result);
                    totalFailed++;
                  }
                } else {
                  await updateLogStatus(supabase, event.id, userId, channel, offset.minutes, 'skipped', 'no_active_bot');
                  totalSkipped++;
                }
              } else if (channel === 'email' && profile.email) {
                const { data: emailResult, error: emailError } = await supabase.functions.invoke('send-email', {
                  body: {
                    to: profile.email,
                    subject: renderedSubject,
                    html: renderedText,
                    context: {
                      user_id: userId,
                      event_type: 'live_event_notification',
                      meta: { live_event_id: event.id, offset_minutes: offset.minutes },
                    },
                  },
                });

                if (emailError) {
                  console.error(`[live-notif-cron] Email invoke error for ${userId}:`, emailError);
                  await updateLogStatusFull(supabase, event.id, userId, channel, offset.minutes, 'failed',
                    emailError.message || String(emailError), null, { error: String(emailError) });
                  totalFailed++;
                } else {
                  // Check if email result indicates success
                  const emailSuccess = emailResult && !emailResult.error;
                  if (emailSuccess) {
                    await updateLogStatusFull(supabase, event.id, userId, channel, offset.minutes, 'sent', null,
                      emailResult?.id || null, emailResult);
                    totalSent++;
                  } else {
                    await updateLogStatusFull(supabase, event.id, userId, channel, offset.minutes, 'failed',
                      emailResult?.error || 'Email send returned error', null, emailResult);
                    totalFailed++;
                  }
                }
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

    const result: any = {
      ok: true,
      dry_run: isDryRun,
      dispatch_mode: isDryRun ? 'dry_run' : (config.proof_mode ? 'proof' : 'production'),
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
      no_audience: eventsNoAudience,
      source_not_ready: eventsSourceNotReady,
    };

    if (isDryRun) {
      result.preview = dryRunPreview;
      result.preview_count = dryRunPreview.length;
    }

    return jsonRes(result);
  } catch (err) {
    console.error('[live-notif-cron] Unexpected error:', err);
    return jsonRes({ error: 'Internal error' }, 500);
  }
});

async function getActiveBot(supabase: any): Promise<{ botToken: string; botId: string | null } | null> {
  const { data: club } = await supabase
    .from('telegram_clubs')
    .select('bot_id, telegram_bots(bot_token_encrypted)')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  const botToken = (club as any)?.telegram_bots?.bot_token_encrypted;
  const botId = (club as any)?.bot_id ?? null;
  return botToken ? { botToken, botId } : null;
}

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

async function updateLogStatusFull(
  supabase: any,
  eventId: string,
  userId: string,
  channel: string,
  offsetMinutes: number,
  status: string,
  error: string | null,
  providerMessageId: string | null,
  providerResponse: any,
) {
  await supabase
    .from('live_event_notification_log')
    .update({
      status,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      error: error || null,
      provider_message_id: providerMessageId || null,
      provider_response: providerResponse || null,
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
