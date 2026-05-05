/**
 * monitor-rebill-no-extension
 *
 * Diagnostic monitor (NO auto-repair).
 *
 * SOT (PATCH 2026-05):
 *   Для каждого успешного recurring-платежа в окне сравнивается
 *   expected_end_at_minsk = endOfDay Europe/Minsk(paid_at + tariff.access_days)
 *   с фактическим покрытием по user+product:
 *     coverage_end = GREATEST(
 *       MAX(subscriptions_v2.access_end_at) WHERE status='active'
 *         AND user_id=order.user_id AND product_id=order.product_id,
 *       MAX(entitlements.expires_at) WHERE expires_at IS NOT NULL
 *         AND user_id=order.user_id AND product_id=order.product_id
 *     )
 *   Если coverage_end >= expected_end_at_minsk → check считается passed (не алертим).
 *
 * Buckets:
 *   - 'no_extension' (severity critical) — нет покрытия и расхождение > tariff/2.
 *   - 'provider_period_shorter_than_tariff_access_days' (severity warning) —
 *     покрытие отсутствует, но gap ≤ ~36 часов и tariff.access_days ≥ 28.
 *     Кейс bePaid даёт период короче, чем tariff.access_days. Доступ есть,
 *     это не "нет продления", а несовпадение длительности.
 *
 * Window:
 *   - cron mode: paid_at in [now - 24h, now - 15m]
 *   - dry_run mode: paid_at in [now - {dry_run_days|7}d, now - 15m]
 *
 * Excludes:
 *   - installment / internal_installment
 *   - canceled / superseded subscriptions on the order
 *   - payments with existing rebill_backfill_*.fixed or manual_repair.* audit
 *   - same-day drift (date in Minsk equal — not an overshoot)
 *
 * Behaviour:
 *   - persists each new candidate as a system_health_checks row with stable
 *     check_key = `REBILL-NO-EXT:{payment_id}` (idempotent per payment_id)
 *   - re-evaluates already-open REBILL-NO-EXT rows: if coverage теперь покрывает
 *     expected_end — помечает их status='passed', details.resolved_by=
 *     'covered_by_current_active_subscription' (только в health/reporting-слое).
 *   - sends ONE aggregated Telegram message per tick если есть NEW critical
 *     candidates (provider-period-mismatch не алертится).
 *   - НИКОГДА не пишет в subscriptions_v2 / entitlements / payments_v2.
 *   - Не вызывает grant-access / revoke / webhook replay.
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
  dry_run_days?: number;
  source?: string;
  notify?: boolean;
  resolve_only?: boolean; // if true — только переоценка уже открытых, без detect
}

type Reason =
  | 'no_extension'
  | 'provider_period_shorter_than_tariff_access_days'
  | 'audit_missing_with_drift';

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
  coverage_end_at: string | null;
  coverage_source: 'subscription' | 'entitlement' | 'none';
  expected_access_end_at_minsk: string;
  gap_hours: number;
  audit_link_order_dates_updated_present: boolean;
  reason: Reason;
  severity: 'critical' | 'warning';
  covered: boolean;
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
    const dryRunDays = Math.max(1, Math.min(30, body.dry_run_days ?? 7));
    const notify = body.notify ?? !dryRun;
    const source = body.source ?? (dryRun ? 'dry_run' : 'cron');
    const resolveOnly = body.resolve_only === true;

    const fromIso = new Date(
      Date.now() - (dryRun ? dryRunDays * 24 : 24) * 60 * 60 * 1000,
    ).toISOString();
    const toIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // ===== STEP 0. Re-evaluate already-open REBILL-NO-EXT rows =====
    // Если для уже зафиксированной (status='failed') записи теперь есть
    // coverage по active subscription/entitlement — помечаем passed.
    // Только в health-слое. Никаких изменений payments/subs/entitlements.
    const resolvedNow: Array<{
      check_id: string;
      payment_id: string;
      coverage_end_at: string;
      coverage_source: 'subscription' | 'entitlement';
    }> = [];

    const { data: openChecks } = await supabase
      .from('system_health_checks')
      .select('id, check_key, details, status')
      .like('check_key', 'REBILL-NO-EXT:%')
      .eq('status', 'failed')
      .limit(500);

    for (const row of openChecks ?? []) {
      const d = (row as any).details ?? {};
      const userId: string | null = d.user_id ?? null;
      const productId: string | null = d.product_id ?? null;
      const expected: string | null = d.expected_access_end_at_minsk ?? null;
      if (!userId || !productId || !expected) continue;

      const cov = await computeCoverage(supabase, userId, productId);
      if (!cov.coverageEndAt) continue;
      if (new Date(cov.coverageEndAt) >= new Date(expected)) {
        if (!dryRun) {
          await supabase
            .from('system_health_checks')
            .update({
              status: 'passed',
              details: {
                ...d,
                resolved_by: 'covered_by_current_active_subscription',
                resolved_at: new Date().toISOString(),
                coverage_end_at: cov.coverageEndAt,
                coverage_source: cov.source,
              },
            })
            .eq('id', (row as any).id);
        }
        resolvedNow.push({
          check_id: (row as any).id,
          payment_id: d.payment_id,
          coverage_end_at: cov.coverageEndAt,
          coverage_source: cov.source as 'subscription' | 'entitlement',
        });
      }
    }

    if (resolveOnly) {
      return new Response(
        JSON.stringify({
          ok: true,
          mode: 'resolve_only',
          dry_run: dryRun,
          re_evaluated: openChecks?.length ?? 0,
          resolved: resolvedNow.length,
          resolved_items: resolvedNow,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ===== STEP 1. Detect candidates in window =====
    const candidates = await detectCandidates(supabase, fromIso, toIso);

    // ===== STEP 2. Compute coverage per candidate, classify =====
    const enriched: Candidate[] = [];
    for (const r of candidates) {
      const cov = r.user_id && r.product_id
        ? await computeCoverage(supabase, r.user_id, r.product_id)
        : { coverageEndAt: null, source: 'none' as const };

      const expected = new Date(r.expected_access_end_at_minsk);
      const covered = !!(
        cov.coverageEndAt && new Date(cov.coverageEndAt) >= expected
      );

      let reason: Reason = r.audit_present
        ? 'audit_missing_with_drift'
        : 'no_extension';
      let severity: 'critical' | 'warning' = 'critical';

      // Bucket: provider_period_shorter_than_tariff_access_days
      // Условие: нет покрытия, но gap небольшой (≤ ~36ч) и tariff длительный (≥28d).
      // Это значит, что bePaid дал период короче, чем tariff.access_days,
      // а другого active покрытия нет. Доступ всё ещё есть, просто короче.
      if (
        !covered &&
        Number(r.gap_hours) <= 36 &&
        Number(r.access_days) >= 28
      ) {
        reason = 'provider_period_shorter_than_tariff_access_days';
        severity = 'warning';
      }

      enriched.push({
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
        coverage_end_at: cov.coverageEndAt,
        coverage_source: cov.source,
        expected_access_end_at_minsk: r.expected_access_end_at_minsk,
        gap_hours: Number(r.gap_hours),
        audit_link_order_dates_updated_present: !!r.audit_present,
        reason,
        severity,
        covered,
      });
    }

    // covered → не алертим (это passed by coverage)
    const realIssues = enriched.filter((c) => !c.covered);

    // ===== STEP 3. Idempotency =====
    const paymentIds = realIssues.map((c) => c.payment_id);
    let existingKeys = new Set<string>();
    if (paymentIds.length > 0) {
      const keys = paymentIds.map((id) => `REBILL-NO-EXT:${id}`);
      const { data: existing } = await supabase
        .from('system_health_checks')
        .select('check_key')
        .in('check_key', keys);
      existingKeys = new Set((existing ?? []).map((r: any) => r.check_key));
    }
    const fresh = realIssues.filter(
      (c) => !existingKeys.has(`REBILL-NO-EXT:${c.payment_id}`),
    );
    const freshCritical = fresh.filter((c) => c.severity === 'critical');
    const freshWarning = fresh.filter((c) => c.severity === 'warning');

    // ===== STEP 4. Persist new alerts (real run only) =====
    let runId: string | null = null;
    if (!dryRun && fresh.length > 0) {
      const { data: run, error: runErr } = await supabase
        .from('system_health_runs')
        .insert({
          run_type: 'monitor_rebill_no_extension',
          status: 'completed',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          summary: {
            count: fresh.length,
            critical: freshCritical.length,
            warning: freshWarning.length,
            source,
          },
          meta: { window_from: fromIso, window_to: toIso },
        })
        .select('id')
        .single();

      if (runErr) console.error('[monitor-rebill] runs insert error', runErr);
      runId = run?.id ?? null;

      if (runId) {
        const checkRows = fresh.map((c) => ({
          run_id: runId,
          check_key: `REBILL-NO-EXT:${c.payment_id}`,
          check_name:
            c.severity === 'critical'
              ? `Rebill paid but access not extended (${c.email ?? c.user_id ?? 'unknown'})`
              : `Provider period shorter than tariff access_days (${c.email ?? c.user_id ?? 'unknown'})`,
          category: 'payments.rebill',
          status: c.severity === 'critical' ? 'failed' : 'warning',
          details: c,
          count: 1,
        }));
        const { error: chkErr } = await supabase
          .from('system_health_checks')
          .insert(checkRows);
        if (chkErr) console.error('[monitor-rebill] checks insert error', chkErr);
      }
    }

    // ===== STEP 5. Telegram notify (only critical) =====
    let notified = false;
    if (notify && freshCritical.length > 0) {
      const top = freshCritical.slice(0, 10);
      const lines = top.map((c) => {
        const exp = c.expected_access_end_at_minsk?.slice(0, 10);
        const cur = c.current_access_end_at?.slice(0, 10);
        return `• <code>${c.order_number ?? c.order_id.slice(0, 8)}</code> · ${c.email ?? c.user_id ?? '—'} · ${c.product_name ?? c.product_id?.slice(0, 8)} · paid ${c.paid_at.slice(0, 16).replace('T', ' ')} · access ${cur} → expected ${exp} · Δ ${c.gap_hours.toFixed(1)}h`;
      });
      const more = freshCritical.length > top.length
        ? `\n…and ${freshCritical.length - top.length} more`
        : '';
      const message =
        `⚠️ <b>Rebill paid but access NOT extended</b>\n` +
        `Count: <b>${freshCritical.length}</b>\n` +
        `Window: ${fromIso.slice(0, 16).replace('T', ' ')} … ${toIso.slice(0, 16).replace('T', ' ')} UTC\n\n` +
        lines.join('\n') +
        more +
        `\n\n<i>Diagnostic only — no auto-repair. Coverage по user+product уже учтена. Inspect & repair manually.</i>`;

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
        scanned: enriched.length,
        covered_by_current_access: enriched.filter((c) => c.covered).length,
        already_alerted: realIssues.length - fresh.length,
        new_alerts: fresh.length,
        new_critical: freshCritical.length,
        new_warning: freshWarning.length,
        re_evaluated_open: openChecks?.length ?? 0,
        resolved_now: resolvedNow.length,
        run_id: runId,
        telegram_notified: notified,
        candidates: dryRun ? enriched : undefined,
        resolved_items: dryRun ? resolvedNow : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[monitor-rebill] fatal', e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

/**
 * Coverage по user+product:
 *   coverage_end = GREATEST(
 *     MAX(subscriptions_v2.access_end_at) WHERE status='active' AND user_id=? AND product_id=?,
 *     MAX(entitlements.expires_at) WHERE user_id=? AND product_id=? AND expires_at IS NOT NULL
 *   )
 */
async function computeCoverage(
  supabase: any,
  userId: string,
  productId: string,
): Promise<{
  coverageEndAt: string | null;
  source: 'subscription' | 'entitlement' | 'none';
}> {
  const { data: subs } = await supabase
    .from('subscriptions_v2')
    .select('access_end_at')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .eq('status', 'active')
    .order('access_end_at', { ascending: false })
    .limit(1);
  const subMax = subs?.[0]?.access_end_at ?? null;

  const { data: ents } = await supabase
    .from('entitlements')
    .select('expires_at')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .not('expires_at', 'is', null)
    .order('expires_at', { ascending: false })
    .limit(1);
  const entMax = ents?.[0]?.expires_at ?? null;

  if (!subMax && !entMax) return { coverageEndAt: null, source: 'none' };
  if (subMax && (!entMax || new Date(subMax) >= new Date(entMax))) {
    return { coverageEndAt: subMax, source: 'subscription' };
  }
  return { coverageEndAt: entMax, source: 'entitlement' };
}

/**
 * Detect candidates: успешные recurring-платежи в окне, у которых
 * на их subscription_v2 (по order_id) access_end_at < expected_end_at_minsk.
 *
 * NB: первичная фильтрация по subscription по order_id используется только
 * чтобы понять, что у этого платежа есть какая-то ветка с подпиской (не one-time
 * и не installment). Финальное решение «covered/uncovered» принимается
 * НЕ по этой подписке, а по computeCoverage(user, product) выше.
 */
async function detectCandidates(
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
    .select('id, order_number, profile_id, user_id, product_id, tariff_id')
    .in('id', orderIds);
  const ordersById = new Map((orders ?? []).map((o: any) => [o.id, o]));

  const { data: subs } = await supabase
    .from('subscriptions_v2')
    .select('id, order_id, status, access_end_at, billing_type, meta, updated_at')
    .in('order_id', orderIds)
    .order('updated_at', { ascending: false });
  // Берём по каждому order_id ПОСЛЕДНЮЮ active (или иначе самую свежую) запись —
  // НЕ просто первую попавшуюся. Это устраняет первый источник false-positive.
  const subsByOrder = new Map<string, any>();
  for (const s of subs ?? []) {
    const cur = subsByOrder.get((s as any).order_id);
    if (!cur) {
      subsByOrder.set((s as any).order_id, s);
      continue;
    }
    const curActive = cur.status === 'active';
    const newActive = (s as any).status === 'active';
    if (newActive && !curActive) subsByOrder.set((s as any).order_id, s);
  }

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

  // Pre-fetch repair audits, чтобы исключить уже починенные платежи.
  const paymentIdSet = payments.map((p: any) => p.id);
  const { data: repairAudits } = await supabase
    .from('audit_logs')
    .select('action, meta')
    .or('action.like.rebill_backfill_%.fixed,action.like.manual_repair.%,action.like.access_repair.%')
    .gte('created_at', fromIso);
  const repairedPayments = new Set<string>();
  const repairedSubs = new Set<string>();
  const repairedOrders = new Set<string>();
  for (const a of repairAudits ?? []) {
    const m = (a as any).meta ?? {};
    if (m.payment_id) repairedPayments.add(String(m.payment_id));
    if (m.subscription_id) repairedSubs.add(String(m.subscription_id));
    if (m.order_id) repairedOrders.add(String(m.order_id));
  }

  const result: any[] = [];
  for (const p of payments as any[]) {
    if (repairedPayments.has(p.id)) continue;
    const o: any = ordersById.get(p.order_id);
    if (!o) continue;
    if (repairedOrders.has(o.id)) continue;
    const s: any = subsByOrder.get(o.id);
    if (!s) continue;
    if (repairedSubs.has(s.id)) continue;
    if (['canceled', 'superseded'].includes(s.status)) continue;
    if ((s.meta?.model ?? '') === 'internal_installment') continue;

    const t: any = tariffsById.get(o.tariff_id);
    const accessDays = t?.access_days ?? 30;
    const paid = new Date(p.paid_at);
    const expectedDate = new Date(paid.getTime() + accessDays * 86400_000);
    const minskKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(expectedDate);
    // Europe/Minsk = UTC+3 year-round
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
    const userId = o.user_id ?? pf?.user_id ?? null;

    result.push({
      payment_id: p.id,
      order_id: o.id,
      order_number: o.order_number,
      user_id: userId,
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
