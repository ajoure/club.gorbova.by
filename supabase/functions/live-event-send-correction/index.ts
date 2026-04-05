import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sends correction/apology messages to the EXACT same recipients
 * who received the original erroneous notification.
 * 
 * Uses live_event_notification_log as the SoT for recipients —
 * no re-querying of audience. Same users, same channels only.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { live_event_id, incident_batch_id, telegram_text, email_subject, email_body_html, dry_run } = await req.json();

  if (!live_event_id || !incident_batch_id) {
    return jsonRes({ error: 'live_event_id and incident_batch_id required' }, 400);
  }

  // Get all SENT records from the original wave (only status=sent, same event)
  const { data: originalLogs, error: logsError } = await supabase
    .from('live_event_notification_log')
    .select('id, user_id, channel, notify_offset_minutes, template_id')
    .eq('live_event_id', live_event_id)
    .eq('status', 'sent')
    .is('correction_of_log_id', null); // only originals, not corrections

  if (logsError) {
    console.error('[send-correction] Error fetching logs:', logsError);
    return jsonRes({ error: 'Failed to fetch original logs' }, 500);
  }

  if (!originalLogs || originalLogs.length === 0) {
    return jsonRes({ ok: true, message: 'No sent records found for correction', sent: 0 });
  }

  // Get profiles for all affected users
  const userIds = [...new Set(originalLogs.map(l => l.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, user_id, email, telegram_user_id, first_name, last_name')
    .in('user_id', userIds);

  const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

  if (dry_run) {
    const preview = originalLogs.map(log => {
      const profile = profileMap.get(log.user_id);
      return {
        original_log_id: log.id,
        user_id: log.user_id,
        user_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'unknown',
        channel: log.channel,
        email: profile?.email,
        telegram_user_id: profile?.telegram_user_id,
        would_send: log.channel === 'telegram' ? telegram_text : email_subject,
      };
    });
    return jsonRes({ ok: true, dry_run: true, preview, count: preview.length });
  }

  // Get active bot for Telegram
  let botToken: string | null = null;
  const { data: club } = await supabase
    .from('telegram_clubs')
    .select('telegram_bots(bot_token_encrypted)')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  botToken = (club as any)?.telegram_bots?.bot_token_encrypted || null;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const log of originalLogs) {
    const profile = profileMap.get(log.user_id);
    if (!profile) {
      skipped++;
      continue;
    }

    // Insert correction log entry linked to original
    const { error: insertErr } = await supabase
      .from('live_event_notification_log')
      .insert({
        live_event_id,
        template_id: log.template_id,
        user_id: log.user_id,
        channel: log.channel,
        notify_offset_minutes: log.notify_offset_minutes,
        scheduled_for: new Date().toISOString(),
        status: 'pending',
        dispatch_mode: 'incident_correction',
        correction_of_log_id: log.id,
        incident_batch_id,
        rendered_subject: log.channel === 'email' ? email_subject : null,
        rendered_text: log.channel === 'telegram' ? telegram_text : email_body_html,
      });

    if (insertErr) {
      console.error(`[send-correction] Insert error for ${log.user_id}:`, insertErr);
      failed++;
      continue;
    }

    try {
      if (log.channel === 'telegram' && profile.telegram_user_id && botToken && telegram_text) {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: profile.telegram_user_id,
            text: telegram_text,
            parse_mode: 'Markdown',
          }),
        });

        const result = await response.json();
        if (result.ok) {
          await supabase
            .from('live_event_notification_log')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              provider_message_id: String(result.result?.message_id || ''),
              provider_response: result,
            })
            .eq('live_event_id', live_event_id)
            .eq('user_id', log.user_id)
            .eq('channel', log.channel)
            .eq('dispatch_mode', 'incident_correction')
            .eq('incident_batch_id', incident_batch_id);
          sent++;
        } else {
          await supabase
            .from('live_event_notification_log')
            .update({
              status: 'failed',
              error: JSON.stringify(result),
              provider_response: result,
            })
            .eq('live_event_id', live_event_id)
            .eq('user_id', log.user_id)
            .eq('channel', log.channel)
            .eq('dispatch_mode', 'incident_correction')
            .eq('incident_batch_id', incident_batch_id);
          failed++;
        }
      } else if (log.channel === 'email' && profile.email && email_subject && email_body_html) {
        const { data: emailResult, error: emailError } = await supabase.functions.invoke('send-email', {
          body: {
            to: profile.email,
            subject: email_subject,
            html: email_body_html,
            context: {
              user_id: log.user_id,
              event_type: 'incident_correction',
              meta: { live_event_id, incident_batch_id, original_log_id: log.id },
            },
          },
        });

        if (emailError || emailResult?.error) {
          await supabase
            .from('live_event_notification_log')
            .update({
              status: 'failed',
              error: emailError?.message || emailResult?.error || 'email_send_failed',
              provider_response: emailResult || { error: String(emailError) },
            })
            .eq('live_event_id', live_event_id)
            .eq('user_id', log.user_id)
            .eq('channel', log.channel)
            .eq('dispatch_mode', 'incident_correction')
            .eq('incident_batch_id', incident_batch_id);
          failed++;
        } else {
          await supabase
            .from('live_event_notification_log')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              provider_message_id: emailResult?.id || null,
              provider_response: emailResult,
            })
            .eq('live_event_id', live_event_id)
            .eq('user_id', log.user_id)
            .eq('channel', log.channel)
            .eq('dispatch_mode', 'incident_correction')
            .eq('incident_batch_id', incident_batch_id);
          sent++;
        }
      } else {
        skipped++;
        await supabase
          .from('live_event_notification_log')
          .update({ status: 'skipped', error: `no_${log.channel}_capability` })
          .eq('live_event_id', live_event_id)
          .eq('user_id', log.user_id)
          .eq('channel', log.channel)
          .eq('dispatch_mode', 'incident_correction')
          .eq('incident_batch_id', incident_batch_id);
      }
    } catch (err) {
      console.error(`[send-correction] Send error:`, err);
      failed++;
    }
  }

  return jsonRes({
    ok: true,
    incident_batch_id,
    original_count: originalLogs.length,
    sent,
    failed,
    skipped,
  });
});

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
