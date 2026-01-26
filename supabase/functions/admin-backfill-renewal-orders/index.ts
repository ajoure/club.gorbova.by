import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ensureOrderForPayment, EnsureOrderResult } from '../_shared/ensure-order-for-payment.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Admin Backfill: Fix Payment-Order Invariants
 * 
 * PATCH 7: Enhanced with safeguards
 * - Timebox: 25 seconds max execution
 * - Batch limit: 50-100 per call
 * - Max failures: 3 before stopping
 * - Continuation cursor: after_id for pagination
 * - Dynamic trial_mismatch: uses order.final_price + 0.01
 * 
 * Handles TWO types of anomalies:
 * 1. ORPHAN: payments with status='succeeded' AND order_id IS NULL
 * 2. TRIAL_MISMATCH: payments with status='succeeded', amount > order.final_price, linked to trial order
 */

// PATCH 7: Timebox constant
const TIMEBOX_MS = 25000; // 25 seconds

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Check for internal key auth (service-only mode)
    const internalKey = req.headers.get('X-Internal-Key');
    const expectedInternalKey = Deno.env.get('INTERNAL_BACKFILL_KEY');
    
    let requestedByUserId: string | null = null;

    if (internalKey && expectedInternalKey && internalKey === expectedInternalKey) {
      // Service-only mode: skip user auth
      requestedByUserId = 'service-internal';
      console.log('Backfill: service-only mode via X-Internal-Key');
    } else {
      // Auth check using user's token
      const authHeader = req.headers.get('Authorization');
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader || '' } },
      });
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      requestedByUserId = user.id;

      // Admin client for data operations + RBAC check
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      const { data: userRoles } = await supabase
        .from('user_roles_v2')
        .select('role_id, roles!inner(name)')
        .eq('user_id', user.id);

      const isAdmin = userRoles?.some((r: any) => {
        const roleName = r.roles?.name?.toLowerCase() || '';
        return ['admin', 'superadmin', 'super_admin', 'администратор', 'супер-администратор'].includes(roleName);
      });

      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Admin client for operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // Default to dry_run = true
    const batchLimit = Math.min(body.batch_limit || 50, 100); // PATCH 7: Default 50, max 100
    const maxFailures = body.max_failures || 3; // PATCH 7: Default 3
    const specificPaymentId = body.payment_id || null;
    const anomalyType = body.anomaly_type || 'all'; // 'orphan', 'trial_mismatch', or 'all'
    const afterId = body.after_id || null; // PATCH 7: Continuation cursor

    console.log(`Backfill: dry_run=${dryRun}, batch_limit=${batchLimit}, max_failures=${maxFailures}, anomaly_type=${anomalyType}, after_id=${afterId}`);

    // ============= FIND CANDIDATES =============
    
    interface PaymentCandidate {
      id: string;
      amount: number;
      order_id: string | null;
      user_id: string | null;
      provider_payment_id: string | null;
      paid_at: string | null;
      meta: Record<string, any> | null;
      anomaly_type: 'orphan' | 'trial_mismatch';
      order_final_price?: number; // For trial_mismatch
    }
    
    const candidates: PaymentCandidate[] = [];

    // TYPE 1: ORPHAN payments (no order_id)
    if (anomalyType === 'all' || anomalyType === 'orphan') {
      let orphanQuery = supabase
        .from('payments_v2')
        .select('id, amount, order_id, user_id, provider_payment_id, paid_at, meta')
        .eq('status', 'succeeded')
        .gt('amount', 0)
        .is('order_id', null)
        .order('created_at', { ascending: true }) // For cursor pagination
        .limit(batchLimit);

      if (specificPaymentId) {
        orphanQuery = orphanQuery.eq('id', specificPaymentId);
      }
      
      // PATCH 7: Continuation cursor
      if (afterId && !specificPaymentId) {
        orphanQuery = orphanQuery.gt('id', afterId);
      }

      const { data: orphans, error: orphanErr } = await orphanQuery;

      if (orphanErr) {
        console.error('Failed to fetch orphan candidates:', orphanErr);
      } else {
        for (const p of orphans || []) {
          candidates.push({
            ...p,
            meta: (p.meta || {}) as Record<string, any>,
            anomaly_type: 'orphan',
          });
        }
        console.log(`Found ${orphans?.length || 0} orphan payment candidates`);
      }
    }

    // TYPE 2: TRIAL MISMATCH (payment > trial order.final_price, linked to trial order)
    // PATCH 7: Dynamic threshold using order.final_price + 0.01 instead of hardcoded 10
    if (anomalyType === 'all' || anomalyType === 'trial_mismatch') {
      let trialQuery = supabase
        .from('payments_v2')
        .select(`
          id,
          amount,
          order_id,
          user_id,
          provider_payment_id,
          paid_at,
          meta,
          orders_v2!inner(id, is_trial, final_price)
        `)
        .eq('status', 'succeeded')
        .gt('amount', 0) // PATCH 7: Removed hardcoded >10, will filter in JS
        .eq('orders_v2.is_trial', true)
        .order('created_at', { ascending: true })
        .limit(batchLimit * 2); // Fetch more since we'll filter

      if (specificPaymentId) {
        trialQuery = trialQuery.eq('id', specificPaymentId);
      }
      
      // PATCH 7: Continuation cursor
      if (afterId && !specificPaymentId) {
        trialQuery = trialQuery.gt('id', afterId);
      }

      const { data: trialMismatches, error: trialErr } = await trialQuery;

      if (trialErr) {
        console.error('Failed to fetch trial mismatch candidates:', trialErr);
      } else {
        // PATCH 7: Dynamic threshold - filter by order.final_price + 0.01
        const filtered = (trialMismatches || []).filter((p: any) => {
          const meta = (p.meta || {}) as Record<string, any>;
          const order = p.orders_v2;
          const orderFinalPrice = order?.final_price || 0;
          
          // Skip if already has renewal_order_id or ensured_order_id
          if (meta.renewal_order_id || meta.ensured_order_id) return false;
          
          // PATCH 7: Dynamic threshold instead of hardcoded 10
          return p.amount > orderFinalPrice + 0.01;
        });
        
        for (const p of filtered) {
          // Skip duplicates if already added as orphan
          if (!candidates.find(c => c.id === p.id)) {
            candidates.push({
              id: p.id,
              amount: p.amount,
              order_id: p.order_id,
              user_id: p.user_id,
              provider_payment_id: p.provider_payment_id,
              paid_at: p.paid_at,
              meta: (p.meta || {}) as Record<string, any>,
              anomaly_type: 'trial_mismatch',
              order_final_price: (p.orders_v2 as any)?.final_price,
            });
          }
        }
        console.log(`Found ${filtered.length} trial mismatch candidates (dynamic threshold)`);
      }
    }

    // Limit total candidates
    const toProcess = candidates.slice(0, batchLimit);
    const remaining = candidates.length - toProcess.length;

    console.log(`Total candidates: ${candidates.length}, processing: ${toProcess.length}, remaining: ${remaining}`);

    // ============= DRY RUN MODE =============
    if (dryRun) {
      await supabase.from('audit_logs').insert({
        action: 'subscription.renewal_backfill_dry_run',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-backfill-renewal-orders',
        meta: {
          requested_by_user_id: requestedByUserId,
          dry_run: true,
          anomaly_type: anomalyType,
          orphan_count: candidates.filter(c => c.anomaly_type === 'orphan').length,
          trial_mismatch_count: candidates.filter(c => c.anomaly_type === 'trial_mismatch').length,
          total_candidates: candidates.length,
          to_process_count: toProcess.length,
          remaining,
          sample_ids: toProcess.slice(0, 10).map(p => ({ id: p.id, type: p.anomaly_type })),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        anomaly_type: anomalyType,
        orphan_count: candidates.filter(c => c.anomaly_type === 'orphan').length,
        trial_mismatch_count: candidates.filter(c => c.anomaly_type === 'trial_mismatch').length,
        total_candidates: candidates.length,
        to_process: toProcess.length,
        remaining,
        sample: toProcess.slice(0, 20).map(p => ({
          payment_id: p.id,
          amount: p.amount,
          order_id: p.order_id,
          user_id: p.user_id,
          anomaly_type: p.anomaly_type,
          bepaid_uid: p.provider_payment_id || p.meta?.bepaid_uid,
          paid_at: p.paid_at,
        })),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============= EXECUTE MODE =============
    let processed = 0;
    let created = 0;
    let relinked = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: { payment_id: string; action: string; order_id?: string }[] = [];

    for (const payment of toProcess) {
      // PATCH 7: Timebox check
      if (Date.now() - startTime > TIMEBOX_MS) {
        console.log(`Timebox reached (${TIMEBOX_MS}ms), stopping batch at ${processed} processed`);
        break;
      }
      
      try {
        // Use centralized helper for consistency
        const result: EnsureOrderResult = await ensureOrderForPayment(
          supabase, 
          payment.id, 
          'admin-backfill-renewal-orders'
        );

        processed++;

        switch (result.action) {
          case 'created':
            created++;
            results.push({ payment_id: payment.id, action: 'created', order_id: result.orderId! });
            console.log(`Created order ${result.orderId} for payment ${payment.id} (${payment.anomaly_type})`);
            break;
          case 'relinked':
            relinked++;
            results.push({ payment_id: payment.id, action: 'relinked', order_id: result.orderId! });
            console.log(`Relinked payment ${payment.id} to order ${result.orderId}`);
            break;
          case 'skipped':
            skipped++;
            results.push({ payment_id: payment.id, action: 'skipped' });
            break;
          case 'error':
            failed++;
            errors.push(`payment ${payment.id}: ${result.reason}`);
            results.push({ payment_id: payment.id, action: 'error' });
            break;
        }

        // STOP on too many failures
        if (failed >= maxFailures) {
          console.error(`Too many failures (${failed}/${maxFailures}), stopping batch`);
          break;
        }
      } catch (err) {
        console.error(`Error processing payment ${payment.id}:`, err);
        errors.push(`payment ${payment.id}: ${(err as Error).message}`);
        failed++;
        
        if (failed >= maxFailures) {
          console.error(`Too many failures (${failed}/${maxFailures}), stopping batch`);
          break;
        }
      }
    }
    
    // PATCH 7: Calculate last_processed_id for continuation cursor
    const lastProcessedId = results.length > 0 ? results[results.length - 1].payment_id : null;
    const timeboxReached = Date.now() - startTime > TIMEBOX_MS;
    const executionTimeMs = Date.now() - startTime;

    // ============= AUDIT LOG =============
    await supabase.from('audit_logs').insert({
      action: 'subscription.renewal_backfill_executed',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-backfill-renewal-orders',
      meta: {
        requested_by_user_id: requestedByUserId,
        dry_run: false,
        anomaly_type: anomalyType,
        total_candidates: candidates.length,
        to_process_count: toProcess.length,
        processed,
        created,
        relinked,
        skipped,
        failed,
        remaining,
        stopped_early: failed >= maxFailures,
        sample_results: results.slice(0, 20),
        errors: errors.slice(0, 10),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      dry_run: false,
      anomaly_type: anomalyType,
      total_candidates: candidates.length,
      to_process: toProcess.length,
      processed,
      created,
      relinked,
      skipped,
      failed,
      remaining,
      // PATCH 7: Enhanced response with continuation info
      stopped_early: failed >= maxFailures || timeboxReached,
      stop_reason: failed >= maxFailures ? 'max_failures' : (timeboxReached ? 'timebox' : null),
      execution_time_ms: executionTimeMs,
      last_processed_id: lastProcessedId, // Use this as after_id for next call
      results: results.slice(0, 50),
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error as Error).message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
