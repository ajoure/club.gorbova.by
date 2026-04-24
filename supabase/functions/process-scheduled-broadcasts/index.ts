/**
 * process-scheduled-broadcasts
 *
 * Single shared cron dispatcher for ALL scheduled and recurring broadcasts.
 * Pattern mirrors live-event-notifications-cron, but for broadcast_templates.
 *
 * Triggers:
 *   - cron (every minute)
 *   - manual: POST { dry_run?: bool, force_template_id?: uuid }
 *
 * Guards:
 *   1) broadcast_dispatcher_config.enabled  → controlled skip if false
 *   2) broadcast_dispatcher_config.production_approved → only dry_run allowed otherwise
 *   3) broadcast_runs UNIQUE idempotency_key → prevents double-send across cron tick overlap
 *   4) anti-empty-audience guard → never sends if audience_count = 0 (logs as skipped)
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DispatchRequest {
  dry_run?: boolean;
  force_template_id?: string;
}

interface BroadcastTemplate {
  id: string;
  name: string;
  status: string;
  send_mode: string;
  channels: string[];
  channel: string;
  message_text: string | null;
  button_text: string | null;
  button_url: string | null;
  email_subject: string | null;
  email_body_html: string | null;
  audience_filters: Record<string, unknown> | null;
  media_storage_path: string | null;
  media_type: string | null;
  media_file_name: string | null;
  recurrence_rule: Record<string, unknown> | null;
  next_run_at: string | null;
  last_run_at: string | null;
  total_runs: number;
  email_only_when_no_telegram: boolean;
  template_type: string | null;
  live_event_id: string | null;
}

interface BroadcastFunctionResult {
  success?: boolean;
  sent?: number;
  failed?: number;
  skipped?: number;
  per_bot?: unknown;
  error?: string;
}

function jsonRes(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    ...(init ?? {}),
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let reqBody: DispatchRequest = {};
  try { reqBody = await req.json(); } catch { /* empty body ok for cron */ }

  const isDryRun = reqBody.dry_run === true;
  const forceTemplateId = reqBody.force_template_id || null;

  // ===== Guard 1: kill-switch =====
  const { data: config, error: cfgErr } = await supabase
    .from('broadcast_dispatcher_config')
    .select('enabled, production_approved')
    .eq('id', 1)
    .single();

  if (cfgErr) {
    console.error('[broadcast-dispatcher] config read failed:', cfgErr);
    return jsonRes({ ok: false, error: 'config_read_failed' }, { status: 500 });
  }

  if (!config?.enabled) {
    console.log('[broadcast-dispatcher] kill-switch off — controlled skip');
    return jsonRes({
      ok: true, controlled_skip: true, reason: 'dispatcher_disabled',
      processed: 0, sent: 0, failed: 0,
    });
  }

  // ===== Guard 2: production approval =====
  if (!isDryRun && !config.production_approved) {
    console.log('[broadcast-dispatcher] production not approved — only dry_run allowed');
    return jsonRes({
      ok: true, controlled_skip: true, reason: 'production_not_approved',
      hint: 'Set broadcast_dispatcher_config.production_approved=true or pass dry_run=true',
      processed: 0, sent: 0, failed: 0,
    });
  }

  // ===== Pick due templates =====
  const nowIso = new Date().toISOString();
  let query = supabase
    .from('broadcast_templates')
    .select('*')
    .in('status', ['scheduled', 'recurring'])
    .not('next_run_at', 'is', null)
    .lte('next_run_at', nowIso)
    .limit(50);

  if (forceTemplateId) {
    query = supabase.from('broadcast_templates').select('*').eq('id', forceTemplateId).limit(1);
  }

  const { data: templates, error: tplErr } = await query;
  if (tplErr) {
    console.error('[broadcast-dispatcher] template fetch failed:', tplErr);
    return jsonRes({ ok: false, error: 'template_fetch_failed' }, { status: 500 });
  }

  const list = (templates || []) as BroadcastTemplate[];
  console.log(`[broadcast-dispatcher] picked ${list.length} template(s), dry_run=${isDryRun}`);

  let totalSent = 0, totalFailed = 0, totalSkipped = 0;
  const perTemplateLog: unknown[] = [];

  for (const tpl of list) {
    const channels = (tpl.channels && tpl.channels.length > 0)
      ? tpl.channels
      : (tpl.channel ? [tpl.channel] : []);

    if (channels.length === 0) {
      console.warn(`[broadcast-dispatcher] template ${tpl.id} has no channels — skip`);
      continue;
    }

    const triggeredBy = isDryRun
      ? 'dry_run'
      : (tpl.send_mode === 'recurring' ? 'recurring' : 'scheduled');

    // Resolve audience once via the canonical RPC (single source of truth)
    const { data: audienceRpc, error: audErr } = await supabase
      .rpc('resolve_broadcast_audience', { _filters: tpl.audience_filters || {} });

    if (audErr) {
      console.error(`[broadcast-dispatcher] audience rpc failed for ${tpl.id}:`, audErr);
      perTemplateLog.push({ template_id: tpl.id, error: audErr.message });
      continue;
    }

    const aud = (audienceRpc ?? {}) as Record<string, unknown>;
    const tgCount = Number(aud.telegram_count || 0);
    const emailCount = Number(aud.email_count || 0);
    const totalCount = Number(aud.total_count || 0);

    // ===== Anti-empty-audience guard =====
    if (totalCount === 0) {
      console.warn(`[broadcast-dispatcher] template ${tpl.id} empty audience — skipping send`);
      // Still record a skipped run so it shows in history
      const epochMin = Math.floor(Date.now() / 60000);
      for (const channel of channels) {
        const idemKey = `tpl:${tpl.id}:${channel}:${epochMin}:${triggeredBy}`;
        await supabase.from('broadcast_runs').insert({
          template_id: tpl.id,
          channel,
          dry_run: isDryRun,
          triggered_by: triggeredBy,
          idempotency_key: idemKey,
          audience_count: 0,
          skipped_count: 1,
          finished_at: new Date().toISOString(),
          error: 'empty_audience',
          audience_snapshot: { telegram_count: tgCount, email_count: emailCount, total_count: 0 },
        });
      }
      totalSkipped += 1;

      // For one-shot scheduled: still advance to 'sent' to avoid infinite re-pick
      // For recurring: roll forward next_run_at so we try next slot
      await advanceTemplate(supabase, tpl, isDryRun);
      perTemplateLog.push({ template_id: tpl.id, skipped: 'empty_audience' });
      continue;
    }

    // Per-channel send
    let templateSent = 0, templateFailed = 0;
    const epochMin = Math.floor(Date.now() / 60000);

    for (const channel of channels) {
      const idemKey = `tpl:${tpl.id}:${channel}:${epochMin}:${triggeredBy}`;

      // Pre-insert run row (UNIQUE on idempotency_key blocks duplicates)
      const { data: runRow, error: insErr } = await supabase
        .from('broadcast_runs')
        .insert({
          template_id: tpl.id,
          channel,
          dry_run: isDryRun,
          triggered_by: triggeredBy,
          idempotency_key: idemKey,
          audience_count: channel === 'telegram' ? tgCount : emailCount,
          audience_snapshot: {
            telegram_count: tgCount,
            email_count: emailCount,
            total_count: totalCount,
            email_only_when_no_telegram: tpl.email_only_when_no_telegram,
          },
        })
        .select('id')
        .maybeSingle();

      if (insErr) {
        // Likely unique violation = another tick already started this run; safe to skip
        console.log(`[broadcast-dispatcher] idempotency hit for ${idemKey}: ${insErr.message}`);
        continue;
      }

      const runId = runRow?.id;

      if (isDryRun) {
        // Dry-run: do not actually invoke broadcast functions, just record snapshot
        await supabase.from('broadcast_runs')
          .update({
            finished_at: new Date().toISOString(),
            sent_count: 0,
            failed_count: 0,
            skipped_count: 0,
          })
          .eq('id', runId);
        continue;
      }

      // ===== Real send: invoke existing broadcast edge function =====
      try {
        let result: BroadcastFunctionResult;
        if (channel === 'telegram') {
          // Build audience_filters with email_only_when_no_telegram is irrelevant for TG
          const tgFilters = tpl.audience_filters || {};
          const { data, error } = await supabase.functions.invoke('telegram-mass-broadcast', {
            body: {
              message: tpl.message_text || '',
              include_button: !!tpl.button_url,
              button_text: tpl.button_text || undefined,
              button_url: tpl.button_url || undefined,
              filters: tgFilters,
              media_storage_path: tpl.media_storage_path || undefined,
              media_type: tpl.media_type || undefined,
              media_file_name: tpl.media_file_name || undefined,
              template_type: tpl.template_type || undefined,
              live_event_id: tpl.live_event_id || undefined,
            },
          });
          if (error) throw new Error(error.message);
          result = (data || {}) as BroadcastFunctionResult;
        } else {
          // email channel: optionally narrow audience to "no telegram"
          let emailFilters: Record<string, unknown> = tpl.audience_filters || {};
          if (tpl.email_only_when_no_telegram) {
            emailFilters = { ...emailFilters, only_no_telegram: true };
          }
          const { data, error } = await supabase.functions.invoke('email-mass-broadcast', {
            body: {
              subject: tpl.email_subject || '',
              html: tpl.email_body_html || '',
              filters: emailFilters,
            },
          });
          if (error) throw new Error(error.message);
          result = (data || {}) as BroadcastFunctionResult;
        }

        const sent = Number(result.sent || 0);
        const failed = Number(result.failed || 0);
        const skipped = Number(result.skipped || 0);
        templateSent += sent;
        templateFailed += failed;

        await supabase.from('broadcast_runs').update({
          finished_at: new Date().toISOString(),
          sent_count: sent,
          failed_count: failed,
          skipped_count: skipped,
          audience_snapshot: {
            telegram_count: tgCount,
            email_count: emailCount,
            total_count: totalCount,
            email_only_when_no_telegram: tpl.email_only_when_no_telegram,
            per_bot: result.per_bot ?? null,
          },
        }).eq('id', runId);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[broadcast-dispatcher] send failed tpl=${tpl.id} ch=${channel}: ${msg}`);
        await supabase.from('broadcast_runs').update({
          finished_at: new Date().toISOString(),
          error: msg,
        }).eq('id', runId);
        templateFailed += 1;
      }
    }

    totalSent += templateSent;
    totalFailed += templateFailed;

    // Advance template state
    if (!isDryRun) {
      await advanceTemplate(supabase, tpl, false, templateSent, templateFailed);
    }

    perTemplateLog.push({
      template_id: tpl.id,
      name: tpl.name,
      channels,
      sent: templateSent,
      failed: templateFailed,
    });
  }

  // ===== System-actor audit log =====
  if (!isDryRun && list.length > 0) {
    await supabase.from('audit_logs').insert({
      action: 'broadcast_dispatcher_run',
      entity_type: 'broadcast_template',
      entity_id: forceTemplateId || null,
      actor_type: 'system',
      meta: {
        processed_templates: list.length,
        sent: totalSent,
        failed: totalFailed,
        skipped: totalSkipped,
        details: perTemplateLog,
      },
    });
  }

  return jsonRes({
    ok: true,
    dry_run: isDryRun,
    processed: list.length,
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
    templates: perTemplateLog,
  });
});

/**
 * Advance template state after a run.
 *  - scheduled (one-shot): → status='sent'
 *  - recurring: recompute next_run_at via compute_next_broadcast_run()
 *               If returned null (past ends_at) → status='sent', next_run_at=null
 */
async function advanceTemplate(
  supabase: ReturnType<typeof createClient>,
  tpl: BroadcastTemplate,
  dryRun: boolean,
  sent = 0,
  failed = 0,
) {
  if (dryRun) return;

  const nowIso = new Date().toISOString();

  if (tpl.send_mode === 'recurring' && tpl.recurrence_rule) {
    const { data: nextTs, error } = await supabase
      .rpc('compute_next_broadcast_run', { rule: tpl.recurrence_rule, from_ts: nowIso });

    if (error) {
      console.error(`[broadcast-dispatcher] compute_next failed for ${tpl.id}:`, error);
      return;
    }

    if (nextTs) {
      await supabase.from('broadcast_templates').update({
        last_run_at: nowIso,
        next_run_at: nextTs,
        total_runs: (tpl.total_runs || 0) + 1,
        sent_count: (tpl as unknown as { sent_count?: number }).sent_count
          ? ((tpl as unknown as { sent_count: number }).sent_count + sent) : sent,
        failed_count: (tpl as unknown as { failed_count?: number }).failed_count
          ? ((tpl as unknown as { failed_count: number }).failed_count + failed) : failed,
      }).eq('id', tpl.id);
    } else {
      // Past ends_at — finalize
      await supabase.from('broadcast_templates').update({
        status: 'sent',
        last_run_at: nowIso,
        next_run_at: null,
        total_runs: (tpl.total_runs || 0) + 1,
        sent_at: nowIso,
        sent_count: sent,
        failed_count: failed,
      }).eq('id', tpl.id);
    }
  } else {
    // One-shot scheduled
    await supabase.from('broadcast_templates').update({
      status: 'sent',
      last_run_at: nowIso,
      next_run_at: null,
      total_runs: (tpl.total_runs || 0) + 1,
      sent_at: nowIso,
      sent_count: sent,
      failed_count: failed,
    }).eq('id', tpl.id);
  }
}
