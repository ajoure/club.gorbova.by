// autoweb-generate-occurrences
// Sprint A — материализует publishable scheduled-сессии по RRULE на occurrences_window_days вперёд.
// Идемпотентно: уникальный partial-индекс live_event_sessions_public_uq защищает от дублей.
// Cron: запускать раз в час. Также используется admin-ом для preview (dry_run=true).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { RRule, rrulestr } from 'npm:rrule@2.8.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface OccurrencePreview {
  starts_at: string;
  ends_at: string;
  excluded_blackout: boolean;
}

function expandRRule(
  rruleStr: string,
  windowDays: number,
  blackoutDates: string[],
  durationMs: number,
  replayDelayMin: number,
  replayWindowH: number,
): OccurrencePreview[] {
  const now = new Date();
  const until = new Date(now.getTime() + windowDays * 24 * 3600 * 1000);
  const rule = rrulestr(rruleStr.startsWith('RRULE:') ? rruleStr : `RRULE:${rruleStr}`, {
    dtstart: now,
  }) as RRule;

  const dates = rule.between(now, until, true).slice(0, 200);
  const blackoutSet = new Set((blackoutDates ?? []).map((d) => d));

  return dates.map((d) => {
    const startIso = d.toISOString();
    const endIso = new Date(
      d.getTime() + durationMs + replayDelayMin * 60_000 + replayWindowH * 3600_000,
    ).toISOString();
    const dateKey = startIso.slice(0, 10); // YYYY-MM-DD UTC
    return {
      starts_at: startIso,
      ends_at: endIso,
      excluded_blackout: blackoutSet.has(dateKey),
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';
    const onlyEventId = url.searchParams.get('live_event_id');
    let body: any = null;
    if (req.method === 'POST') {
      body = await req.json().catch(() => null);
    }
    const previewRrule = body?.preview_rrule as string | undefined;
    const previewConfig = body?.preview_config as Record<string, any> | undefined;
    const previewLimit = Number(body?.preview_limit ?? 10);

    // Dry-run preview без записи в БД (используется админкой для UI-превью)
    if (dryRun && previewRrule) {
      const cfg = previewConfig ?? {};
      const windowDays = Number(cfg?.schedule?.occurrences_window_days ?? 14);
      const blackout = (cfg?.schedule?.blackout_dates ?? []) as string[];
      const duration = Number(cfg?.video?.duration_seconds ?? 3600);
      const replayDelay = Number(cfg?.replay?.delay_minutes ?? 0);
      const replayWindow = Number(cfg?.replay?.window_hours ?? 0);

      try {
        const occ = expandRRule(
          previewRrule,
          windowDays,
          blackout,
          duration * 1000,
          replayDelay,
          replayWindow,
        ).slice(0, previewLimit);
        return jsonRes({ status: 'ok', preview: occ });
      } catch (e) {
        return jsonRes({ status: 'invalid_rrule', message: String(e) }, 400);
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let q = supabase
      .from('live_events')
      .select('id, autoweb_config')
      .eq('event_type', 'autowebinar')
      .eq('autoweb_mode', 'scheduled')
      .eq('is_published', true);

    if (onlyEventId) q = q.eq('id', onlyEventId);

    const { data: events, error: eErr } = await q;
    if (eErr) {
      console.error('[autoweb-generate-occurrences] fetch err', eErr);
      return jsonRes({ status: 'error', message: 'Internal error' }, 500);
    }

    let totalGenerated = 0;
    let totalSkipped = 0;
    const perEvent: Array<{ live_event_id: string; generated: number; skipped: number }> = [];

    for (const ev of events ?? []) {
      const cfg = (ev.autoweb_config ?? {}) as Record<string, any>;
      const rrule = cfg?.schedule?.rrule as string | undefined;
      if (!rrule) continue;

      const windowDays = Number(cfg?.schedule?.occurrences_window_days ?? 14);
      const blackout = (cfg?.schedule?.blackout_dates ?? []) as string[];
      const duration = Number(cfg?.video?.duration_seconds ?? 3600);
      const replayDelay = Number(cfg?.replay?.delay_minutes ?? 0);
      const replayWindow = Number(cfg?.replay?.window_hours ?? 0);

      let occurrences: OccurrencePreview[] = [];
      try {
        occurrences = expandRRule(rrule, windowDays, blackout, duration * 1000, replayDelay, replayWindow);
      } catch (e) {
        console.error(`[autoweb-generate-occurrences] bad rrule for ${ev.id}`, e);
        continue;
      }

      let generated = 0;
      let skipped = 0;

      for (const occ of occurrences) {
        if (occ.excluded_blackout) {
          skipped++;
          continue;
        }
        const { error: insErr } = await supabase.from('live_event_sessions').insert({
          live_event_id: ev.id,
          mode: 'scheduled',
          starts_at: occ.starts_at,
          ends_at: occ.ends_at,
          viewer_user_id: null,
          status: 'pending',
        });
        if (insErr) {
          // 23505 = unique_violation → already materialized, это норма
          if ((insErr as any).code === '23505') {
            skipped++;
          } else {
            console.error('[autoweb-generate-occurrences] insert err', insErr);
            skipped++;
          }
        } else {
          generated++;
        }
      }

      totalGenerated += generated;
      totalSkipped += skipped;
      perEvent.push({ live_event_id: ev.id, generated, skipped });
    }

    return jsonRes({
      status: 'ok',
      processed_events: events?.length ?? 0,
      total_generated: totalGenerated,
      total_skipped: totalSkipped,
      per_event: perEvent,
    });
  } catch (e) {
    console.error('[autoweb-generate-occurrences] fatal', e);
    return jsonRes({ status: 'error', message: 'Internal error' }, 500);
  }
});
