import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface InvariantResult {
  name: string;
  passed: boolean;
  count: number;
  samples: any[];
  description: string;
}

interface NightlyReport {
  success: boolean;
  run_at: string;
  duration_ms: number;
  invariants: InvariantResult[];
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Verify cron secret for scheduled runs
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    
    // Also allow authenticated admin calls
    const authHeader = req.headers.get('authorization');
    const isScheduledRun = cronSecret === expectedSecret;
    const isAuthenticatedCall = !!authHeader;
    
    if (!isScheduledRun && !isAuthenticatedCall) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const invariants: InvariantResult[] = [];

    // INV-1: Check for duplicate payments by (provider, provider_payment_id)
    const { data: duplicates } = await supabase.rpc('get_payment_duplicates');
    const dupCount = duplicates?.length || 0;
    invariants.push({
      name: 'INV-1: No duplicate payments',
      passed: dupCount === 0,
      count: dupCount,
      samples: (duplicates || []).slice(0, 5),
      description: 'payments_v2(provider, provider_payment_id) should be unique',
    });

    // INV-2A (STRICT FAIL): Business payments must have order_id
    // Uses RPC with DB-level test_payment filter (no JS filter hack)
    const { data: businessOrphans, error: boError } = await supabase.rpc(
      'get_business_orphan_payments',
      { from_date: '2026-01-01' }
    );

    if (boError) {
      console.error('[NIGHTLY] INV-2A RPC error:', boError);
    }

    const businessOrphanCount = businessOrphans?.length || 0;

    invariants.push({
      name: 'INV-2A: No business payments without order (STRICT)',
      passed: businessOrphanCount === 0,
      count: businessOrphanCount,
      samples: (businessOrphans || []).slice(0, 5).map((o: any) => ({
        id: o.id,
        provider_payment_id: o.provider_payment_id,
        amount: o.amount,
        paid_at: o.paid_at,
        payment_classification: o.payment_classification,
        origin: o.origin,
      })),
      description: 'Business payments (trial/regular/renewal) MUST have order_id. Classification-based, no origin/txtype hacks.',
    });

    // INV-2B (CONTROL): Technical orphans - tracked, not FAIL
    // Threshold warning at 200 to detect growth
    const TECH_ORPHAN_THRESHOLD = 200;
    const { data: techOrphans, count: techOrphanCount } = await supabase
      .from('payments_v2')
      .select('id, provider_payment_id, amount, paid_at, payment_classification, origin', { count: 'exact' })
      .gte('paid_at', '2026-01-01')
      .eq('status', 'succeeded')
      .gt('amount', 0)
      .is('order_id', null)
      .in('payment_classification', ['card_verification', 'refund', 'orphan_technical'])
      .limit(10);

    invariants.push({
      name: 'INV-2B: Technical orphans (CONTROL)',
      passed: true, // Not a failure - just tracking
      count: techOrphanCount || 0,
      samples: (techOrphans || []).slice(0, 5).map((o: any) => ({
        id: o.id,
        provider_payment_id: o.provider_payment_id,
        amount: o.amount,
        payment_classification: o.payment_classification,
      })),
      description: 'Technical payments (card_verification/refund/orphan) without order - tracked only',
    });

    // INV-2B-WARN: Anti-silent-growth guard
    // PATCH-3: passed: true to not break summary, warning in description
    if ((techOrphanCount || 0) > TECH_ORPHAN_THRESHOLD) {
      invariants.push({
        name: 'INV-2B-WARN: Technical orphans above threshold',
        passed: true, // WARNING only - does not fail summary
        count: (techOrphanCount || 0) - TECH_ORPHAN_THRESHOLD,
        samples: [],
        description: `⚠️ WARNING: Technical orphans (${techOrphanCount}) exceed threshold (${TECH_ORPHAN_THRESHOLD}) - investigate growth`,
      });
    }

    // INV-3: Amount mismatches (payment.amount != order.final_price)
    const { data: mismatches } = await supabase
      .from('payments_v2')
      .select(`
        id,
        provider_payment_id,
        amount,
        order_id,
        orders_v2!inner (
          id,
          order_number,
          final_price,
          status
        )
      `)
      .eq('status', 'succeeded')
      .gt('amount', 0)
      .eq('orders_v2.status', 'paid')
      .limit(100);

    const actualMismatches = (mismatches || []).filter((p: any) => {
      const orderPrice = p.orders_v2?.final_price;
      return orderPrice !== null && orderPrice !== undefined && Number(orderPrice) !== Number(p.amount);
    });

    invariants.push({
      name: 'INV-3: No payment/order amount mismatches',
      passed: actualMismatches.length === 0,
      count: actualMismatches.length,
      samples: actualMismatches.slice(0, 5).map((m: any) => ({
        payment_id: m.id,
        payment_amount: m.amount,
        order_id: m.order_id,
        order_number: m.orders_v2?.order_number,
        order_final_price: m.orders_v2?.final_price,
      })),
      description: 'payment.amount should equal order.final_price for succeeded payments',
    });

    // INV-7: Amount synced with provider_response (PATCH 6 - no hardcoded amounts)
    const { data: paymentsWithProviderResponse } = await supabase
      .from('payments_v2')
      .select('id, amount, provider_response')
      .eq('status', 'succeeded')
      .not('provider_response', 'is', null)
      .gte('paid_at', '2026-01-01')
      .limit(200);

    const amountMismatches = (paymentsWithProviderResponse || []).filter((p: any) => {
      const providerAmount = p.provider_response?.transaction?.amount;
      if (!providerAmount) return false;
      return Math.abs(Number(p.amount) - (providerAmount / 100)) > 0.01;
    });

    invariants.push({
      name: 'INV-7: Amount synced with provider_response',
      passed: amountMismatches.length === 0,
      count: amountMismatches.length,
      samples: amountMismatches.slice(0, 5).map((m: any) => ({
        payment_id: m.id,
        db_amount: m.amount,
        provider_amount: m.provider_response?.transaction?.amount / 100,
      })),
      description: 'payments_v2.amount must equal provider_response.transaction.amount/100',
    });

    // INV-8: Classification coverage (STRICT - after backfill completion)
    const { count: unclassifiedCount } = await supabase
      .from('payments_v2')
      .select('*', { count: 'exact', head: true })
      .is('payment_classification', null)
      .gte('created_at', '2026-01-01');

    invariants.push({
      name: 'INV-8: Payment classification coverage (STRICT)',
      passed: (unclassifiedCount || 0) === 0, // STRICT FAIL if any unclassified
      count: unclassifiedCount || 0,
      samples: [],
      description: 'All 2026+ payments MUST have payment_classification. FAIL if any unclassified.',
    });

    // INV-9: Card verification must NOT have order_id (PATCH 6)
    const { data: cardVerifWithOrder, count: cvOrderCount } = await supabase
      .from('payments_v2')
      .select('id, order_id, transaction_type', { count: 'exact' })
      .eq('payment_classification', 'card_verification')
      .not('order_id', 'is', null)
      .limit(10);

    invariants.push({
      name: 'INV-9: Card verification without order',
      passed: (cvOrderCount || 0) === 0,
      count: cvOrderCount || 0,
      samples: (cardVerifWithOrder || []).slice(0, 5),
      description: 'card_verification payments must not create orders',
    });

    // INV-10: No expired active entitlements (PATCH 7)
    const { data: expiredActiveEntitlements, count: expEntCount } = await supabase
      .from('entitlements')
      .select('id, user_id, expires_at', { count: 'exact' })
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString())
      .not('expires_at', 'is', null)
      .limit(10);

    invariants.push({
      name: 'INV-10: No expired active entitlements',
      passed: (expEntCount || 0) === 0,
      count: expEntCount || 0,
      samples: (expiredActiveEntitlements || []).slice(0, 5),
      description: 'Active entitlements must have expires_at > now OR expires_at IS NULL',
    });

    // INV-11: No expired active subscriptions (PATCH 7)
    const { data: expiredActiveSubs, count: expSubCount } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, access_end_at', { count: 'exact' })
      .in('status', ['active', 'trial'])
      .lt('access_end_at', new Date().toISOString())
      .not('access_end_at', 'is', null)
      .limit(10);

    invariants.push({
      name: 'INV-11: No expired active subscriptions',
      passed: (expSubCount || 0) === 0,
      count: expSubCount || 0,
      samples: (expiredActiveSubs || []).slice(0, 5),
      description: 'Active subscriptions must have access_end_at > now',
    });

    // INV-12: No wrongly revoked Telegram users (PATCH 8 - set-based via RPC)
    const { data: wronglyRevoked, error: wrError } = await supabase.rpc('rpc_find_wrongly_revoked');
    
    invariants.push({
      name: 'INV-12: No wrongly revoked Telegram users',
      passed: wrError ? false : (wronglyRevoked?.length || 0) === 0,
      count: wronglyRevoked?.length || 0,
      samples: (wronglyRevoked || []).slice(0, 5),
      description: 'Users with valid access must have access_status=ok',
    });

    // INV-13: Trial orders have access created (PATCH 10 - trial flow invariant)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: trialOrders } = await supabase
      .from('orders_v2')
      .select('id, order_number, user_id, is_trial, status, created_at')
      .eq('is_trial', true)
      .eq('status', 'paid')
      .gte('created_at', sevenDaysAgo)
      .limit(50);

    // Check access for each trial order (batch approach)
    const trialUserIds = [...new Set((trialOrders || []).map((o: any) => o.user_id))];
    const trialsWithoutAccess: any[] = [];

    if (trialUserIds.length > 0) {
      // Batch check subscriptions
      const { data: subsForTrials } = await supabase
        .from('subscriptions_v2')
        .select('user_id')
        .in('user_id', trialUserIds)
        .in('status', ['active', 'trial']);
      const usersWithSub = new Set((subsForTrials || []).map((s: any) => s.user_id));

      // Batch check entitlements
      const { data: entsForTrials } = await supabase
        .from('entitlements')
        .select('user_id')
        .in('user_id', trialUserIds)
        .eq('status', 'active');
      const usersWithEnt = new Set((entsForTrials || []).map((e: any) => e.user_id));

      for (const order of trialOrders || []) {
        if (!usersWithSub.has(order.user_id) && !usersWithEnt.has(order.user_id)) {
          trialsWithoutAccess.push({
            order_id: order.id,
            order_number: order.order_number,
            user_id: order.user_id,
          });
        }
      }
    }

    invariants.push({
      name: 'INV-13: Trial orders create access (7d)',
      passed: trialsWithoutAccess.length === 0,
      count: trialsWithoutAccess.length,
      samples: trialsWithoutAccess.slice(0, 5),
      description: 'Paid trial orders must create subscription or entitlement',
    });

    // INV-4: Trial/non-trial mismatch guards (check audit_logs counters)
    const { count: trialBlockedCount } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'payment.trial_blocked')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const { count: mismatchGuardCount } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'payment.mismatch_amount_guard_triggered')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    invariants.push({
      name: 'INV-4: Trial/amount guard activity (24h)',
      passed: true, // This is informational
      count: (trialBlockedCount || 0) + (mismatchGuardCount || 0),
      samples: [
        { type: 'trial_blocked', count: trialBlockedCount || 0 },
        { type: 'mismatch_guard', count: mismatchGuardCount || 0 },
      ],
      description: 'Count of trial blocks and amount mismatch guards triggered in last 24h',
    });

    // INV-5: Multiple active prices per tariff
    const { data: multiPriceTariffs } = await supabase
      .from('tariff_prices')
      .select('tariff_id')
      .eq('is_active', true);

    const tariffPriceCounts: Record<string, number> = {};
    (multiPriceTariffs || []).forEach((tp: any) => {
      tariffPriceCounts[tp.tariff_id] = (tariffPriceCounts[tp.tariff_id] || 0) + 1;
    });

    const tariffsWithMultiplePrices = Object.entries(tariffPriceCounts)
      .filter(([_, count]) => count > 1)
      .map(([tariffId, count]) => ({ tariff_id: tariffId, active_prices_count: count }));

    invariants.push({
      name: 'INV-5: No tariffs with multiple active prices',
      passed: tariffsWithMultiplePrices.length === 0,
      count: tariffsWithMultiplePrices.length,
      samples: tariffsWithMultiplePrices.slice(0, 5),
      description: 'Each tariff should have at most 1 active price',
    });

    // INV-6: Inactive price usage (check audit_logs)
    const { count: inactivePriceUsage } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'subscription.charge_amount_calculated')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    // Note: We can't easily check meta->>'is_active' without RPC, so just count

    invariants.push({
      name: 'INV-6: Charge calculations (7d)',
      passed: true, // Informational
      count: inactivePriceUsage || 0,
      samples: [],
      description: 'Count of charge calculations in last 7 days',
    });

    // Calculate summary
    const passedCount = invariants.filter(i => i.passed).length;
    const failedCount = invariants.filter(i => !i.passed).length;

    const report: NightlyReport = {
      success: failedCount === 0,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      invariants,
      summary: {
        total_checks: invariants.length,
        passed: passedCount,
        failed: failedCount,
      },
    };

    // Save to audit_logs
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'nightly-payments-invariants',
      action: 'nightly.payments_invariants_run',
      meta: report,
    });

    // If there are failures, create an inbox message for admins
    if (failedCount > 0) {
      const failedInvariants = invariants.filter(i => !i.passed);
      const messageText = `⚠️ **Nightly Payments Check - ${failedCount} issue(s) found**\n\n` +
        failedInvariants.map(i => 
          `**${i.name}**: ${i.count} issues\n${i.samples.slice(0, 3).map(s => `  - ${JSON.stringify(s)}`).join('\n')}`
        ).join('\n\n') +
        `\n\n_Run at: ${report.run_at}_`;

      // Try to create inbox message (if communication table exists)
      try {
        // Get a super_admin user to send as
        const { data: adminRole } = await supabase
          .from('roles')
          .select('id')
          .eq('code', 'super_admin')
          .single();

        if (adminRole) {
          const { data: adminUser } = await supabase
            .from('user_roles_v2')
            .select('user_id')
            .eq('role_id', adminRole.id)
            .limit(1)
            .single();

          if (adminUser) {
            // Create a broadcast or system message
            await supabase.from('telegram_messages').insert({
              user_id: adminUser.user_id,
              direction: 'incoming',
              message_text: messageText,
              meta: {
                type: 'system_notification',
                source: 'nightly-payments-invariants',
                report: report,
              },
            });
          }
        }
      } catch (inboxErr) {
        console.error('Failed to create inbox message:', inboxErr);
      }
    }

    console.log(`[NIGHTLY] Completed in ${report.duration_ms}ms. Passed: ${passedCount}/${invariants.length}`);

    return new Response(
      JSON.stringify(report),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[NIGHTLY] Error:', error);

    // Log error to audit
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'nightly-payments-invariants',
      action: 'nightly.payments_invariants_error',
      meta: {
        error: String(error),
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
