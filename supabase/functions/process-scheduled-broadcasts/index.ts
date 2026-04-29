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
  force_execute?: boolean;
  force_secret?: string;
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
  const forceExecute = reqBody.force_execute === true;
  const providedForceSecret = reqBody.force_secret || null;

  // ===== Force-execute path (PATCH-D lite, Sprint B safety) =====
  // If force_execute=true + force_template_id + valid force_secret:
  //   - bypass Guard 1 (kill-switch) AND Guard 2 (production_approved)
  //   - process EXACTLY one template (force_template_id), never picks other due templates
  //   - parallel cron tick that runs WITHOUT force_secret stays gated by Guards 1/2 as usual,
  //     so other due templates (e.g. "Тест 1") cannot leak through
  let forceAuthorized = false;
  if (forceExecute) {
    if (!forceTemplateId) {
      return jsonRes({ ok: false, error: 'force_execute_requires_template_id' }, { status: 400 });
    }
    if (isDryRun) {
      return jsonRes({ ok: false, error: 'force_execute_incompatible_with_dry_run' }, { status: 400 });
    }
    const expectedSecret = Deno.env.get('BROADCAST_FORCE_SECRET');
    if (!expectedSecret || !providedForceSecret || providedForceSecret !== expectedSecret) {
      console.warn('[broadcast-dispatcher] force_execute denied: invalid secret');
      return jsonRes({ ok: false, error: 'invalid_force_secret' }, { status: 403 });
    }
    forceAuthorized = true;
    console.log(`[broadcast-dispatcher] FORCE_EXECUTE authorized for template ${forceTemplateId}`);
  }

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

  if (!config?.enabled && !forceAuthorized) {
    console.log('[broadcast-dispatcher] kill-switch off — controlled skip');
    return jsonRes({
      ok: true, controlled_skip: true, reason: 'dispatcher_disabled',
      processed: 0, sent: 0, failed: 0,
    });
  }

  // ===== Guard 2: production approval =====
  if (!isDryRun && !config.production_approved && !forceAuthorized) {
    console.log('[broadcast-dispatcher] production not approved — only dry_run allowed');
    return jsonRes({
      ok: true, controlled_skip: true, reason: 'production_not_approved',
      hint: 'Set broadcast_dispatcher_config.production_approved=true or pass dry_run=true',
      processed: 0, sent: 0, failed: 0,
    });
  }

  // ===== Pick due templates =====
  // PATCH-E: regular cron requires approval_status='approved'.
  // Forced path (force_execute + force_secret) may bypass approval — it is already gated by secret + RBAC at the caller.
  const nowIso = new Date().toISOString();
  let query = supabase
    .from('broadcast_templates')
    .select('*')
    .in('status', ['scheduled', 'recurring'])
    .eq('approval_status', 'approved')
    .not('next_run_at', 'is', null)
    .lte('next_run_at', nowIso)
    .limit(50);

  if (forceTemplateId) {
    // Forced single-template path — bypasses approval (force_secret already validated).
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

    // ===== Atomic lock: prevent the next cron tick from re-picking this template =====
    // Bug fix (29.04.2026): без этого замка между тиками cron шаблон оставался
    // status='scheduled' с next_run_at <= now() до самого вызова advanceTemplate(),
    // и параллельный/следующий тик отправлял те же сообщения повторно (по 2-3 раза).
    // Skip lock for: dry_run (read-only), force_template_id (operator override).
    // Stable slot key for idempotency — origin scheduled slot, не «минута запуска».
    const slotKey: string = (tpl.next_run_at as string) || `force:${nowIso}`;
    if (!isDryRun && !forceTemplateId && tpl.next_run_at) {
      const { data: lockedRows, error: lockErr } = await supabase
        .from('broadcast_templates')
        .update({ next_run_at: null })
        .eq('id', tpl.id)
        .eq('next_run_at', tpl.next_run_at)
        .select('id');
      if (lockErr) {
        console.error(`[broadcast-dispatcher] lock failed for ${tpl.id}:`, lockErr);
        perTemplateLog.push({ template_id: tpl.id, error: `lock_failed: ${lockErr.message}` });
        continue;
      }
      if (!lockedRows || lockedRows.length === 0) {
        console.log(`[broadcast-dispatcher] template ${tpl.id} already locked by parallel tick — skip`);
        perTemplateLog.push({ template_id: tpl.id, skipped: 'lock_lost_to_parallel_tick' });
        continue;
      }
    }

    // Resolve audience once via the canonical RPC (single source of truth)
    // Dispatcher runs under service_role (no auth.uid()), so we mark the call
    // as system-bypass so the RPC skips the entitlements.manage check.
    const audFiltersForRpc = {
      ...(tpl.audience_filters || {}),
      __system_bypass: true,
    };
    const { data: audienceRpc, error: audErr } = await supabase
      .rpc('resolve_broadcast_audience', { _filters: audFiltersForRpc });

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
    // SAFETY: never mark template as 'sent' on empty audience.
    //  - scheduled  → revert to 'draft', clear next_run_at, requires operator action
    //  - recurring  → roll forward next_run_at to the next slot (skip cycle), keep status
    //  - dry_run    → just record skipped run, no template mutation
    if (totalCount === 0) {
      console.warn(`[broadcast-dispatcher] template ${tpl.id} empty audience — skipping send`);
      for (const channel of channels) {
        const idemKey = `tpl:${tpl.id}:${channel}:${slotKey}:${triggeredBy}`;
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

      if (!isDryRun) {
        const nowIso2 = new Date().toISOString();
        if (tpl.send_mode === 'recurring' && tpl.recurrence_rule) {
          // Skip this cycle — roll forward to next slot. Status stays 'recurring'.
          const { data: nextTs } = await supabase
            .rpc('compute_next_broadcast_run', { rule: tpl.recurrence_rule, from_ts: nowIso2 });
          await supabase.from('broadcast_templates').update({
            last_run_at: nowIso2,
            next_run_at: nextTs ?? null,
            // do NOT increment total_runs/sent_count — nothing was sent
          }).eq('id', tpl.id);
        } else {
          // One-shot scheduled: revert to draft so it does NOT re-pick infinitely,
          // but is also NOT falsely marked as 'sent'. Operator must re-schedule.
          await supabase.from('broadcast_templates').update({
            status: 'draft',
            send_mode: 'manual',
            next_run_at: null,
            last_run_at: nowIso2,
          }).eq('id', tpl.id);
        }

        // Audit log: explicit warning so operator sees it.
        // audit_logs schema has no entity_type/entity_id — embed in meta.
        await supabase.from('audit_logs').insert({
          action: 'broadcast_empty_audience_skip',
          actor_type: 'system',
          actor_label: 'broadcast-dispatcher',
          meta: {
            entity_type: 'broadcast_template',
            entity_id: tpl.id,
            template_name: tpl.name,
            send_mode: tpl.send_mode,
            channels,
            audience_filters: tpl.audience_filters,
            resolution: tpl.send_mode === 'recurring' ? 'cycle_skipped' : 'reverted_to_draft',
          },
        });
      }

      perTemplateLog.push({ template_id: tpl.id, skipped: 'empty_audience', resolution: tpl.send_mode === 'recurring' ? 'cycle_skipped' : 'reverted_to_draft' });
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
      // System-actor bypass: dispatcher authenticates via x-broadcast-internal-secret.
      // No user JWT involved — the broadcast functions accept this only when the
      // matching env secret is present (BROADCAST_INTERNAL_SECRET / BROADCAST_FORCE_SECRET).
      const internalSecret =
        Deno.env.get('BROADCAST_INTERNAL_SECRET') ||
        Deno.env.get('BROADCAST_FORCE_SECRET') ||
        '';
      const systemHeaders: Record<string, string> = {
        'x-system-actor': 'broadcast-dispatcher',
        'x-broadcast-internal-secret': internalSecret,
      };

      try {
        let result: BroadcastFunctionResult;
        if (channel === 'telegram') {
          // Build audience_filters with email_only_when_no_telegram is irrelevant for TG
          const tgFilters = tpl.audience_filters || {};
          const { data, error } = await supabase.functions.invoke('telegram-mass-broadcast', {
            headers: systemHeaders,
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
            headers: systemHeaders,
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
      action: forceAuthorized ? 'broadcast_dispatcher_force_run' : 'broadcast_dispatcher_run',
      actor_type: 'system',
      actor_label: forceAuthorized ? 'broadcast-dispatcher-force' : 'broadcast-dispatcher',
      meta: {
        entity_type: 'broadcast_template',
        entity_id: forceTemplateId || null,
        force_authorized: forceAuthorized,
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
