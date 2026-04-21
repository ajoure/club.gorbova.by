// autoweb-generate-occurrences
// Sprint A (PATCH-1): материализует publishable scheduled-сессии по RRULE на occurrences_window_days вперёд.
//
// РЕЖИМЫ:
//   - dry_run=true → возвращает occurrences БЕЗ записи (для admin UI preview)
//   - dry_run=false (cron / manual execute) → INSERT в live_event_sessions с защитой через partial unique index
//
// Идемпотентно: live_event_sessions_public_uq (live_event_id, starts_at) WHERE viewer_user_id IS NULL.
//
// PATCH-1 (Sprint A → B):
//   • поддержка autoweb_config.schedule.rrules (string[]) — по одному RRULE на каждый time-slot,
//     чтобы избежать декартова произведения BYHOUR×BYMINUTE при нескольких слотах (09:15 + 10:30
//     больше НЕ генерирует 09:30 / 10:15);
//   • blackout сравнение в event_timezone (Intl.DateTimeFormat), а не по UTC ISO;
//   • совместимость: если schedule.rrules отсутствует → fallback на legacy schedule.rrule (один RRULE).

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

/** YYYY-MM-DD в указанной таймзоне (для сравнения с blackout_dates). */
function dateKeyInTz(d: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA → "YYYY-MM-DD"
    return fmt.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function expandSingleRRule(
  rruleStr: string,
  windowDays: number,
  blackoutDates: string[],
  durationMs: number,
  replayDelayMin: number,
  replayWindowH: number,
  timezone: string,
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
    const dateKey = dateKeyInTz(d, timezone);
    return {
      starts_at: startIso,
      ends_at: endIso,
      excluded_blackout: blackoutSet.has(dateKey),
    };
  });
}

/** Объединяет несколько RRULE → дедуплицирует по starts_at → сортирует. */
function expandRules(
  rules: string[],
  windowDays: number,
  blackoutDates: string[],
  durationMs: number,
  replayDelayMin: number,
  replayWindowH: number,
  timezone: string,
): OccurrencePreview[] {
  const merged = new Map<string, OccurrencePreview>();
  for (const r of rules) {
    if (!r) continue;
    let occ: OccurrencePreview[] = [];
    try {
      occ = expandSingleRRule(r, windowDays, blackoutDates, durationMs, replayDelayMin, replayWindowH, timezone);
    } catch (e) {
      console.error('[autoweb-generate-occurrences] bad rule, skipping', r, e);
      continue;
    }
    for (const o of occ) {
      if (!merged.has(o.starts_at)) merged.set(o.starts_at, o);
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Вытаскивает массив RRULE из config: новый schedule.rrules ИЛИ legacy schedule.rrule. */
function rulesFromConfig(cfg: Record<string, any>): string[] {
  const arr = cfg?.schedule?.rrules;
  if (Array.isArray(arr) && arr.length > 0) return arr.filter((s: unknown) => typeof s === 'string');
  const single = cfg?.schedule?.rrule;
  if (typeof single === 'string' && single) return [single];
  return [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let body: any = null;
    if (req.method === 'POST') {
      body = await req.json().catch(() => null);
    }
    // PATCH B: dry_run может прийти и через query (legacy / cron), и через body (supabase-js invoke).
    const dryRun = url.searchParams.get('dry_run') === 'true' || body?.dry_run === true;
    const onlyEventId = url.searchParams.get('live_event_id') || body?.live_event_id || null;

    const previewRrule = body?.preview_rrule as string | undefined;
    const previewRrules = body?.preview_rrules as string[] | undefined;
    const previewConfig = body?.preview_config as Record<string, any> | undefined;
    const previewLimit = Number(body?.preview_limit ?? 10);

    // --- DRY-RUN preview (admin UI), STRICT READ-ONLY early-return.
    // Никаких чтений/записей в live_event_sessions ниже этой ветки при dry_run=true.
    if (dryRun) {
      if (!previewRrule && !(Array.isArray(previewRrules) && previewRrules.length > 0)) {
        return jsonRes({ status: 'invalid_request', message: 'preview_rrules required for dry_run' }, 400);
      }
      const cfg = previewConfig ?? {};
      const windowDays = Number(cfg?.schedule?.occurrences_window_days ?? 14);
      const blackout = (cfg?.schedule?.blackout_dates ?? []) as string[];
      const tz = (cfg?.schedule?.timezone as string) ?? 'Europe/Minsk';
      const duration = Number(cfg?.video?.duration_seconds ?? 3600);
      const replayDelay = Number(cfg?.replay?.delay_minutes ?? 0);
      const replayWindow = Number(cfg?.replay?.window_hours ?? 0);

      const rules = previewRrules && previewRrules.length > 0 ? previewRrules : [previewRrule!];
      try {
        const occ = expandRules(
          rules,
          windowDays,
          blackout,
          duration * 1000,
          replayDelay,
          replayWindow,
          tz,
        ).slice(0, previewLimit);
        return jsonRes({ status: 'ok', preview: occ, timezone: tz, source_rules: rules.length });
      } catch (e) {
        return jsonRes({ status: 'invalid_rrule', message: String(e) }, 400);
      }
    }

    // --- EXECUTE (cron / manual materialization) ---
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let q = supabase
      .from('live_events')
      .select('id, autoweb_config, event_timezone')
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
      const rules = rulesFromConfig(cfg);
      if (rules.length === 0) continue;

      const windowDays = Number(cfg?.schedule?.occurrences_window_days ?? 14);
      const blackout = (cfg?.schedule?.blackout_dates ?? []) as string[];
      const tz = (cfg?.schedule?.timezone as string) ?? (ev as any).event_timezone ?? 'Europe/Minsk';
      const duration = Number(cfg?.video?.duration_seconds ?? 3600);
      const replayDelay = Number(cfg?.replay?.delay_minutes ?? 0);
      const replayWindow = Number(cfg?.replay?.window_hours ?? 0);

      let occurrences: OccurrencePreview[] = [];
      try {
        occurrences = expandRules(rules, windowDays, blackout, duration * 1000, replayDelay, replayWindow, tz);
      } catch (e) {
        console.error(`[autoweb-generate-occurrences] bad rrules for ${ev.id}`, e);
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
