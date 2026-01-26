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

    // INV-2: Orphan payments 2026+ (succeeded, amount>0, profile_id not null, order_id null)
    const { data: orphans, count: orphanCount } = await supabase
      .from('payments_v2')
      .select('id, provider_payment_id, amount, paid_at, profile_id', { count: 'exact' })
      .gte('paid_at', '2026-01-01')
      .eq('status', 'succeeded')
      .gt('amount', 0)
      .not('profile_id', 'is', null)
      .is('order_id', null)
      .limit(10);

    invariants.push({
      name: 'INV-2: No orphan payments 2026+',
      passed: (orphanCount || 0) === 0,
      count: orphanCount || 0,
      samples: (orphans || []).slice(0, 5),
      description: 'All 2026+ succeeded payments should have order_id',
    });

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
