import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * ERIP Reconcile Pending
 * 
 * Polls bePaid API for payments stuck in 'processing' (ERIP pending) and finalizes them.
 * 
 * Auth: X-Cron-Secret header (NOT anon key)
 * Schedule: pg_cron every 5 minutes
 * 
 * Params (JSON body):
 *   execute: boolean (default false = dry-run)
 *   source: string (e.g. "pg_cron", "admin_manual")
 *   payment_id: string (optional — reconcile single payment)
 *   batch_size: number (default 20, max 50)
 */

const BUILD_ID = "erip-reconcile:2026-03-20T12:00:00Z";
const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;
const MIN_AGE_MINUTES = 5;
const MAX_AGE_HOURS = 48;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Auth: STRICTLY x-cron-secret only. No service_role, no anon, no Authorization alternatives.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const incomingSecret = req.headers.get('x-cron-secret');
  const isCronAuth = !!(cronSecret && incomingSecret === cronSecret);

  if (!isCronAuth) {
    console.error('[ERIP-RECONCILE] REJECTED: missing or invalid x-cron-secret');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  console.log('[ERIP-RECONCILE] Auth: cron_secret OK');

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(sbUrl, sbKey);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.execute !== true;
    const source = body.source || 'unknown';
    const singlePaymentId = body.payment_id || null;
    const batchSize = Math.min(body.batch_size || DEFAULT_BATCH, MAX_BATCH);

    console.log(`[${BUILD_ID}] START: dry_run=${dryRun}, source=${source}, single=${singlePaymentId}, batch=${batchSize}`);

    // Get bePaid credentials
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      throw new Error(credsResult.error);
    }
    const bepaidAuth = createBepaidAuthHeader(credsResult);

    // Find stuck ERIP payments
    let query = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, order_id, amount, currency, created_at, meta, status, error_message')
      .eq('provider', 'bepaid');

    if (singlePaymentId) {
      // Single payment mode (manual reconcile) — search both processing AND failed (legacy ERIP stuck)
      query = query
        .in('status', ['processing', 'failed'])
        .eq('provider_payment_id', singlePaymentId);
    } else {
      // Batch mode: processing (FIX-A) + failed (legacy stuck ERIP). JS-filter below ensures ERIP-only.
      query = query.in('status', ['processing', 'failed']);
      const minAgeDate = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
      const maxAgeDate = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', minAgeDate).gt('created_at', maxAgeDate);
    }

    const { data: payments, error: fetchError } = await query.limit(batchSize);

    if (fetchError) {
      throw new Error(`DB fetch error: ${fetchError.message}`);
    }

    console.log(`[${BUILD_ID}] Found ${payments?.length || 0} candidate payments (before ERIP filter)`);

    // JS-filter: only ERIP payments. Strict detection to avoid touching non-ERIP failed.
    const eripPayments = (payments || []).filter(p => {
      const meta = typeof p.meta === 'object' && p.meta ? p.meta as Record<string, unknown> : {};
      // FIX-A records: webhook stored payment_method='erip' or erip_pending=true
      if (meta.payment_method === 'erip' || meta.erip_pending === true) return true;
      // Legacy stuck ERIP (pre-FIX-A): error_message contains ERIP-specific text
      if (p.status === 'failed' && typeof p.error_message === 'string' && p.error_message.includes('Требование')) return true;
      return false;
    });

    console.log(`[${BUILD_ID}] After ERIP filter: ${eripPayments.length} payments`);

    const results: any[] = [];
    let upgraded = 0, markedFailed = 0, stillPending = 0, errors = 0;

    for (const payment of eripPayments) {
      const uid = payment.provider_payment_id;
      try {
        // Query bePaid API by transaction UID (single transaction endpoint)
        const resp = await fetch(`https://gateway.bepaid.by/transactions/${uid}`, {
          method: 'GET',
          headers: {
            'Authorization': bepaidAuth,
            'Accept': 'application/json',
            'X-Api-Version': '3',
          },
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'unknown');
          console.error(`[${BUILD_ID}] bePaid API error for ${uid}: ${resp.status} ${errText}`);
          results.push({ uid, action: 'api_error', status: resp.status });
          errors++;
          continue;
        }

        const data = await resp.json();
        const tx = data?.transaction;
        const bepaidStatus = tx?.status || 'unknown';

        if (dryRun) {
          results.push({
            uid,
            current_status: payment.status,
            bepaid_status: bepaidStatus,
            action: `dry_run:${bepaidStatus === 'successful' ? 'would_upgrade_to_succeeded' : bepaidStatus === 'pending' ? 'still_pending' : 'would_mark_' + bepaidStatus}`,
            order_id: payment.order_id,
          });
          continue;
        }

        if (bepaidStatus === 'successful') {
          // UPGRADE: processing → succeeded
          const now = new Date().toISOString();
          
          // Update payment
          await supabase.from('payments_v2').update({
            status: 'succeeded',
            paid_at: tx.paid_at || tx.created_at || now,
            error_message: null,
            provider_response: { transaction_uid: uid, status: bepaidStatus, amount: tx.amount, currency: tx.currency, paid_at: tx.paid_at },
            meta: {
              ...(typeof payment.meta === 'object' && payment.meta ? payment.meta : {}),
              last_bepaid_status: 'successful',
              last_webhook_at: now,
              erip_reconciled: true,
              erip_reconciled_at: now,
            },
          }).eq('id', payment.id);

          // Update order → paid
          if (payment.order_id) {
            await supabase.from('orders_v2').update({
              status: 'paid',
              paid_amount: payment.amount,
              updated_at: now,
            }).eq('id', payment.order_id)
              .in('status', ['pending', 'failed']); // STOP-GUARD: don't overwrite terminal states

            // Grant access via standard path (same as webhook success-path)
            try {
              await supabase.functions.invoke('grant-access-for-order', {
                body: { orderId: payment.order_id },
              });
              console.log(`[${BUILD_ID}] grant-access invoked for order ${payment.order_id}`);
            } catch (grantErr) {
              console.error(`[${BUILD_ID}] grant-access error (non-fatal):`, grantErr);
            }
          }

          // Mark queue as materialized
          try {
            await supabase.from('payment_reconcile_queue')
              .update({ status: 'materialized', processed_at: now, last_error: null })
              .eq('bepaid_uid', uid);
          } catch (_) {}

          // Audit
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_user_id: null, actor_label: BUILD_ID,
            action: 'bepaid.erip.reconcile_succeeded',
            meta: { payment_id: payment.id, uid, order_id: payment.order_id, source },
          });

          upgraded++;
          results.push({ uid, action: 'upgraded_to_succeeded', order_id: payment.order_id });

        } else if (bepaidStatus === 'failed' || bepaidStatus === 'expired') {
          // Mark as failed
          const now = new Date().toISOString();
          await supabase.from('payments_v2').update({
            status: 'failed',
            error_message: tx.message || bepaidStatus,
            meta: {
              ...(typeof payment.meta === 'object' && payment.meta ? payment.meta : {}),
              last_bepaid_status: bepaidStatus,
              last_webhook_at: now,
              erip_reconciled: true,
            },
          }).eq('id', payment.id);

          if (payment.order_id) {
            await supabase.from('orders_v2').update({
              status: 'failed',
              updated_at: now,
            }).eq('id', payment.order_id)
              .in('status', ['pending']); // Only update pending orders
          }

          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_user_id: null, actor_label: BUILD_ID,
            action: 'bepaid.erip.reconcile_failed',
            meta: { payment_id: payment.id, uid, bepaid_status: bepaidStatus, order_id: payment.order_id, source },
          });

          markedFailed++;
          results.push({ uid, action: 'marked_failed', bepaid_status: bepaidStatus });

        } else {
          // Still pending or unknown — leave as is
          stillPending++;
          results.push({ uid, action: 'still_pending', bepaid_status: bepaidStatus });
        }

      } catch (err) {
        console.error(`[${BUILD_ID}] Error processing ${uid}:`, err);
        errors++;
        results.push({ uid, action: 'error', error: String(err) });
      }
    }

    // Summary audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system', actor_user_id: null, actor_label: BUILD_ID,
      action: 'bepaid.erip.reconcile_batch',
      meta: {
        dry_run: dryRun,
        source,
        total: results.length,
        upgraded,
        marked_failed: markedFailed,
        still_pending: stillPending,
        errors,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      build_id: BUILD_ID,
      dry_run: dryRun,
      summary: { total: results.length, upgraded, marked_failed: markedFailed, still_pending: stillPending, errors },
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[${BUILD_ID}] FATAL:`, error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
