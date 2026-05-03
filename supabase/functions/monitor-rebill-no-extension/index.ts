/**
 * monitor-rebill-no-extension
 *
 * Diagnostic monitor (NO auto-repair).
 *
 * SOT: successful recurring payment exists, but subscription.access_end_at <= expected_end_at_minsk,
 * where expected_end_at_minsk = endOfDay Europe/Minsk for (paid_at + access_days).
 *
 * Window:
 *   - cron mode: paid_at in [now - 24h, now - 15m]
 *   - dry_run mode: paid_at in [now - {dry_run_days|7}d, now - 15m]
 *
 * Excludes:
 *   - installment / internal_installment
 *   - canceled / superseded subscriptions
 *   - payments with existing rebill_backfill_*.fixed or manual_repair.* audit
 *   - same-day drift (date in Minsk equal — not an overshoot)
 *
 * Behaviour:
 *   - persists each new candidate as a system_health_checks row with stable
 *     check_key = `REBILL-NO-EXT:{payment_id}` (idempotent per payment_id)
 *   - sends ONE aggregated Telegram message per tick if there are any NEW candidates
 *   - never repairs or modifies subscriptions/entitlements
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  dry_run?: boolean;
  dry_run_days?: number; // override for dry-run window (default 7)
  source?: string;
  notify?: boolean; // default true; set false in dry_run
}

interface Candidate {
  payment_id: string;
  order_id: string;
  order_number: string | null;
  user_id: string | null;
  email: string | null;
  product_id: string | null;
  product_name: string | null;
  tariff_id: string | null;
  tariff_name: string | null;
  subscription_id: string;
  paid_at: string;
  access_days: number;
  current_access_end_at: string;
  expected_access_end_at_minsk: string;
  gap_hours: number;
  audit_link_order_dates_updated_present: boolean;
  reason: 'no_extension' | 'partial_extension' | 'audit_missing_with_drift';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const dryRun = body.dry_run === true;
    const dryRunDays = Math.max(
      1,
      Math.min(30, body.dry_run_days ?? 7),
    );
    const notify = body.notify ?? !dryRun;
    const source = body.source ?? (dryRun ? 'dry_run' : 'cron');

    const fromIso = new Date(
      Date.now() -
        (dryRun ? dryRunDays * 24 : 24) * 60 * 60 * 1000,
    ).toISOString();
    const toIso = new Date(
      Date.now() - 15 * 60 * 1000,
    ).toISOString();

    // 1. Detection query
    const sqlDetect = `
      WITH candidates AS (
        SELECT
          p.id          AS payment_id,
          p.order_id    AS order_id,
          p.paid_at     AS paid_at,
          o.order_number,
          o.profile_id,
          o.product_id,
          o.tariff_id,
          s.id          AS subscription_id,
          s.status::text AS sub_status,
          s.access_end_at,
          s.billing_type,
          s.meta->>'model' AS sub_model,
          COALESCE(t.access_days, 30) AS access_days,
          pr.name       AS product_name,
          tf.name       AS tariff_name,
          pf.email      AS user_email,
          pf.user_id    AS user_id
        FROM payments_v2 p
        JOIN orders_v2 o ON o.id = p.order_id
        LEFT JOIN subscriptions_v2 s ON s.order_id = o.id
        LEFT JOIN tariffs t ON t.id = o.tariff_id
        LEFT JOIN products_v2 pr ON pr.id = o.product_id
        LEFT JOIN tariffs tf ON tf.id = o.tariff_id
        LEFT JOIN profiles pf ON pf.id = o.profile_id
        WHERE p.status = 'succeeded'
          AND p.is_recurring = true
          AND p.paid_at BETWEEN '${fromIso}'::timestamptz AND '${toIso}'::timestamptz
      ),
      expected AS (
        SELECT c.*,
          ((date_trunc('day',
              (c.paid_at + (c.access_days || ' days')::interval)
                AT TIME ZONE 'Europe/Minsk')
             + interval '1 day' - interval '1 second')
             AT TIME ZONE 'Europe/Minsk') AS expected_end_utc
        FROM candidates c
      )
      SELECT
        e.payment_id::text                             AS payment_id,
        e.order_id::text                               AS order_id,
        e.order_number,
        e.user_id::text                                AS user_id,
        e.user_email,
        e.product_id::text                             AS product_id,
        e.product_name,
        e.tariff_id::text                              AS tariff_id,
        e.tariff_name,
        e.subscription_id::text                        AS subscription_id,
        e.paid_at,
        e.access_days,
        e.access_end_at                                AS current_access_end_at,
        e.expected_end_utc                             AS expected_access_end_at_minsk,
        ROUND(EXTRACT(EPOCH FROM (e.expected_end_utc - e.access_end_at))/3600, 2)::float8 AS gap_hours,
        EXISTS (
          SELECT 1 FROM audit_logs a
          WHERE a.action = 'bepaid.webhook.link_order_dates_updated'
            AND (a.meta->>'order_id') = e.order_id::text
            AND a.created_at BETWEEN e.paid_at - interval '5 minutes'
                                AND e.paid_at + interval '30 minutes'
        ) AS audit_present
      FROM expected e
      WHERE e.subscription_id IS NOT NULL
        AND e.sub_status NOT IN ('canceled','superseded')
        AND COALESCE(e.sub_model,'') <> 'internal_installment'
        AND e.access_end_at < e.expected_end_utc
        -- exclude same-day drift (date-level overshoot only)
        AND date_trunc('day', e.access_end_at AT TIME ZONE 'Europe/Minsk')
          < date_trunc('day', e.expected_end_utc AT TIME ZONE 'Europe/Minsk')
        -- exclude payments with backfill/manual repair audit
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs a
          WHERE (a.action LIKE 'rebill_backfill_%.fixed'
              OR a.action LIKE 'manual_repair.%'
              OR a.action LIKE 'access_repair.%')
            AND ((a.meta->>'payment_id') = e.payment_id::text
              OR (a.meta->>'subscription_id') = e.subscription_id::text
              OR (a.meta->>'order_id') = e.order_id::text)
        )
      ORDER BY e.paid_at DESC
      LIMIT 200;
    `;

    const { data: rows, error: detectErr } = await supabase.rpc(
      'exec_readonly_sql',
      { sql: sqlDetect },
    ).select();

    // Fallback: if RPC isn't present, run via PostgREST raw — but we don't expose raw SQL.
    // Instead use a safer pre-built view-style approach via supabase-js builder:
    let candidates: any[] = [];
    if (detectErr || !rows) {
      // Fallback path using JS-side filtering
      candidates = await fallbackDetect(supabase, fromIso, toIso);
    } else {
      candidates = rows as any[];
    }

    const mapped: Candidate[] = candidates.map((r: any) => {
      const reason: Candidate['reason'] = r.audit_present
        ? 'audit_missing_with_drift' // audit present but дата не доехала
        : 'no_extension';
      return {
        payment_id: r.payment_id,
        order_id: r.order_id,
        order_number: r.order_number ?? null,
        user_id: r.user_id ?? null,
        email: r.user_email ?? null,
        product_id: r.product_id ?? null,
        product_name: r.product_name ?? null,
        tariff_id: r.tariff_id ?? null,
        tariff_name: r.tariff_name ?? null,
        subscription_id: r.subscription_id,
        paid_at: r.paid_at,
        access_days: Number(r.access_days),
        current_access_end_at: r.current_access_end_at,
        expected_access_end_at_minsk: r.expected_access_end_at_minsk,
        gap_hours: Number(r.gap_hours),
        audit_link_order_dates_updated_present: !!r.audit_present,
        reason: r.audit_present ? 'audit_missing_with_drift' : reason,
      };
    });

    // 2. Idempotency: filter out payments that already have an alert row
    const paymentIds = mapped.map((c) => c.payment_id);
    let existingKeys = new Set<string>();
    if (paymentIds.length > 0) {
      const keys = paymentIds.map((id) => `REBILL-NO-EXT:${id}`);
      const { data: existing } = await supabase
        .from('system_health_checks')
        .select('check_key')
        .in('check_key', keys);
      existingKeys = new Set((existing ?? []).map((r: any) => r.check_key));
    }
    const fresh = mapped.filter(
      (c) => !existingKeys.has(`REBILL-NO-EXT:${c.payment_id}`),
    );

    // 3. Persist new alerts as system_health_checks rows (real run only)
    let runId: string | null = null;
    if (!dryRun && fresh.length > 0) {
      const { data: run, error: runErr } = await supabase
        .from('system_health_runs')
        .insert({
          run_type: 'monitor_rebill_no_extension',
          status: 'completed',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          summary: { count: fresh.length, source },
          meta: { window_from: fromIso, window_to: toIso },
        })
        .select('id')
        .single();

      if (runErr) {
        console.error('[monitor-rebill] runs insert error', runErr);
      }
      runId = run?.id ?? null;

      if (runId) {
        const checkRows = fresh.map((c) => ({
          run_id: runId,
          check_key: `REBILL-NO-EXT:${c.payment_id}`,
          check_name: `Rebill paid but access not extended (${c.email ?? c.user_id ?? 'unknown'})`,
          category: 'payments.rebill',
          status: 'failed',
          details: c,
          count: 1,
        }));
        const { error: chkErr } = await supabase
          .from('system_health_checks')
          .insert(checkRows);
        if (chkErr) console.error('[monitor-rebill] checks insert error', chkErr);
      }
    }

    // 4. Aggregated Telegram notify
    let notified = false;
    if (notify && fresh.length > 0) {
      const top = fresh.slice(0, 10);
      const lines = top.map((c) => {
        const exp = c.expected_access_end_at_minsk?.slice(0, 10);
        const cur = c.current_access_end_at?.slice(0, 10);
        return `• <code>${c.order_number ?? c.order_id.slice(0, 8)}</code> · ${c.email ?? c.user_id ?? '—'} · ${c.product_name ?? c.product_id?.slice(0, 8)} · paid ${c.paid_at.slice(0, 16).replace('T', ' ')} · access ${cur} → expected ${exp} · Δ ${c.gap_hours.toFixed(1)}h`;
      });
      const more = fresh.length > top.length
        ? `\n…and ${fresh.length - top.length} more`
        : '';
      const message =
        `⚠️ <b>Rebill paid but access NOT extended</b>\n` +
        `Count: <b>${fresh.length}</b>\n` +
        `Window: ${fromIso.slice(0, 16).replace('T', ' ')} … ${toIso.slice(0, 16).replace('T', ' ')} UTC\n\n` +
        lines.join('\n') +
        more +
        `\n\n<i>Diagnostic only — no auto-repair. Inspect & repair manually.</i>`;

      try {
        const { error: notifyErr } = await supabase.functions.invoke(
          'telegram-notify-admins',
          {
            body: {
              message,
              parse_mode: 'HTML',
              source: 'monitor-rebill-no-extension',
            },
          },
        );
        if (notifyErr) {
          console.error('[monitor-rebill] telegram-notify error', notifyErr);
        } else {
          notified = true;
        }
      } catch (e) {
        console.error('[monitor-rebill] telegram-notify exception', e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        window: { from: fromIso, to: toIso },
        scanned: mapped.length,
        already_alerted: mapped.length - fresh.length,
        new_alerts: fresh.length,
        run_id: runId,
        telegram_notified: notified,
        candidates: dryRun ? mapped : undefined, // full payload only in dry-run
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[monitor-rebill] fatal', e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 200, // soft-fail: monitor must never break the platform
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

/**
 * Fallback detector using supabase-js builder when no SQL RPC is available.
 * Less efficient — only used if the primary SQL path fails.
 */
async function fallbackDetect(
  supabase: any,
  fromIso: string,
  toIso: string,
): Promise<any[]> {
  const { data: payments } = await supabase
    .from('payments_v2')
    .select('id, order_id, paid_at, status, is_recurring')
    .eq('status', 'succeeded')
    .eq('is_recurring', true)
    .gte('paid_at', fromIso)
    .lte('paid_at', toIso)
    .order('paid_at', { ascending: false })
    .limit(500);

  if (!payments || payments.length === 0) return [];

  const orderIds = [...new Set(payments.map((p: any) => p.order_id))];
  const { data: orders } = await supabase
    .from('orders_v2')
    .select('id, order_number, profile_id, product_id, tariff_id')
    .in('id', orderIds);
  const ordersById = new Map((orders ?? []).map((o: any) => [o.id, o]));

  const { data: subs } = await supabase
    .from('subscriptions_v2')
    .select('id, order_id, status, access_end_at, billing_type, meta')
    .in('order_id', orderIds);
  const subsByOrder = new Map((subs ?? []).map((s: any) => [s.order_id, s]));

  const tariffIds = [...new Set((orders ?? []).map((o: any) => o.tariff_id).filter(Boolean))];
  const { data: tariffs } = tariffIds.length
    ? await supabase.from('tariffs').select('id, name, access_days').in('id', tariffIds)
    : { data: [] };
  const tariffsById = new Map((tariffs ?? []).map((t: any) => [t.id, t]));

  const productIds = [...new Set((orders ?? []).map((o: any) => o.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await supabase.from('products_v2').select('id, name').in('id', productIds)
    : { data: [] };
  const productsById = new Map((products ?? []).map((p: any) => [p.id, p]));

  const profileIds = [...new Set((orders ?? []).map((o: any) => o.profile_id).filter(Boolean))];
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, user_id, email').in('id', profileIds)
    : { data: [] };
  const profilesById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const result: any[] = [];
  for (const p of payments) {
    const o: any = ordersById.get(p.order_id);
    if (!o) continue;
    const s: any = subsByOrder.get(o.id);
    if (!s) continue;
    if (['canceled', 'superseded'].includes(s.status)) continue;
    if ((s.meta?.model ?? '') === 'internal_installment') continue;

    const t: any = tariffsById.get(o.tariff_id);
    const accessDays = t?.access_days ?? 30;
    const paid = new Date(p.paid_at);
    const expectedDate = new Date(paid.getTime() + accessDays * 86400_000);
    // EOD Minsk: compute YYYY-MM-DD in Minsk, then 23:59:59 → UTC
    const minskKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(expectedDate);
    // Approximate: Europe/Minsk = UTC+3 year-round
    const expectedEndUtc = new Date(`${minskKey}T23:59:59+03:00`);

    const current = new Date(s.access_end_at);
    if (current >= expectedEndUtc) continue;

    const curMinsk = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(current);
    if (curMinsk === minskKey) continue; // same-day drift

    const pr: any = productsById.get(o.product_id);
    const pf: any = profilesById.get(o.profile_id);

    result.push({
      payment_id: p.id,
      order_id: o.id,
      order_number: o.order_number,
      user_id: pf?.user_id ?? null,
      user_email: pf?.email ?? null,
      product_id: o.product_id,
      product_name: pr?.name ?? null,
      tariff_id: o.tariff_id,
      tariff_name: t?.name ?? null,
      subscription_id: s.id,
      paid_at: p.paid_at,
      access_days: accessDays,
      current_access_end_at: s.access_end_at,
      expected_access_end_at_minsk: expectedEndUtc.toISOString(),
      gap_hours: (expectedEndUtc.getTime() - current.getTime()) / 3_600_000,
      audit_present: false,
    });
  }
  return result;
}
