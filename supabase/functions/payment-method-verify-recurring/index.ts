import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
// 3DS-related error codes from bePaid that indicate card requires 3DS for each transaction
const REQUIRES_3DS_CODES = ['P.4011', 'P.4012', 'P.4013', 'P.4014', 'P.4015'];

// Rate limit / temporary error codes that should trigger retry
const RETRIABLE_CODES = ['G.9999', 'N.1001', 'N.1002', 'N.1003'];

function calculateBackoff(attempt: number): number {
  // Exponential backoff: 1min, 5min, 15min, 30min, 60min
  const delays = [60, 300, 900, 1800, 3600];
  return delays[Math.min(attempt, delays.length - 1)] * 1000;
}

interface VerificationJob {
  id: string;
  payment_method_id: string;
  user_id: string;
  attempt_count: number;
  max_attempts: number;
  status: string;
  idempotency_key: string;
}

interface PaymentMethod {
  id: string;
  provider_token: string;
  last4: string;
  brand: string;
  user_id: string;
}

interface RejectedCardForNotification {
  id: string;
  user_id: string;
  brand: string;
  last4: string;
  verification_checked_at: string | null;
}

interface ProcessingResult {
  verified: number;
  rejected: number;
  retried: number;
  failed: number;
  skipped: number;
  notified: number;
  errors: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // === X-Cron-Secret OR Admin JWT Security Gate ===
  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedSecret = req.headers.get('X-Cron-Secret') || req.headers.get('x-cron-secret');
  const authHeader = req.headers.get('Authorization');
  
  let isAuthorized = false;
  let authMethod = 'none';
  let adminUserId: string | null = null;

  // Method 1: X-Cron-Secret (for pg_cron / GitHub Actions)
  if (cronSecret && providedSecret === cronSecret) {
    isAuthorized = true;
    authMethod = 'cron_secret';
    console.log('[SECURITY] Authorized via X-Cron-Secret');
  }
  
  // Method 2: Admin JWT (for manual UI trigger)
  if (!isAuthorized && authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (user) {
      // Check if user has admin role
      const { data: adminCheck } = await supabase
        .rpc('has_role', { _user_id: user.id, _role: 'admin' });
      
      if (adminCheck) {
        isAuthorized = true;
        authMethod = 'admin_jwt';
        adminUserId = user.id;
        console.log('[SECURITY] Authorized via admin JWT:', user.id);
      } else {
        // Also check super_admin
        const { data: superAdminCheck } = await supabase
          .rpc('has_role', { _user_id: user.id, _role: 'super_admin' });
        
        if (superAdminCheck) {
          isAuthorized = true;
          authMethod = 'admin_jwt';
          adminUserId = user.id;
          console.log('[SECURITY] Authorized via super_admin JWT:', user.id);
        }
      }
    }
  }

  // Deny if not authorized
  if (!isAuthorized) {
    console.warn('[SECURITY] Authorization failed:', { 
      hasCronSecret: !!cronSecret, 
      hasProvidedSecret: !!providedSecret, 
      hasAuthHeader: !!authHeader 
    });
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'payment-method-verify-recurring',
      action: 'cron.auth.failed',
      meta: { 
        auth_method: authMethod,
        has_cron_secret: !!providedSecret,
        has_jwt: !!authHeader,
        timestamp: new Date().toISOString() 
      },
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // === End Security Gate ===

  // Parse request body
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run ?? true; // Default to dry_run for safety
  const limit = Math.min(body.limit ?? 10, 50); // Max 50 per run for safety
  const notifyOnly = body.notify_only ?? false; // MODE D: Only send notifications for already rejected cards

  console.log(`[payment-method-verify-recurring] Starting: dry_run=${dryRun}, limit=${limit}, notify_only=${notifyOnly}`);

  const now = new Date().toISOString();

  // ===========================================================================
  // MODE D: notify_only — backfill notifications for already rejected cards
  // ===========================================================================
  if (notifyOnly) {
    // Find payment_methods with verification_status='rejected' that haven't been notified
    const { data: rejectedCards, error: fetchRejectedError } = await supabase
      .from('payment_methods')
      .select('id, user_id, brand, last4, verification_status, verification_checked_at')
      .eq('verification_status', 'rejected')
      .eq('status', 'active')
      .order('verification_checked_at', { ascending: true })
      .limit(limit);

    if (fetchRejectedError) {
      console.error('[notify_only] Error fetching rejected cards:', fetchRejectedError);
      return new Response(JSON.stringify({ error: fetchRejectedError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!rejectedCards || rejectedCards.length === 0) {
      return new Response(JSON.stringify({
        mode: dryRun ? 'dry_run' : 'execute',
        notify_only: true,
        message: 'No rejected cards found for notification',
        count: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Filter out cards that already have a notification sent after verification_checked_at
    // PATCH B: Dedup by (user_id, message_type, payment_method_id, created_at > verification_checked_at)
    const cardsToNotify: RejectedCardForNotification[] = [];
    for (const card of rejectedCards) {
      const checkedAt = card.verification_checked_at || '2000-01-01';
      
      // Check if notification already sent via notification_outbox for THIS SPECIFIC CARD
      const { data: existingNotification } = await supabase
        .from('notification_outbox')
        .select('id')
        .eq('user_id', card.user_id)
        .eq('message_type', 'card_not_suitable_for_autopay')
        .eq('status', 'sent')
        .filter('meta->>payment_method_id', 'eq', card.id) // PATCH B: Check by payment_method_id
        .gt('created_at', checkedAt)
        .limit(1)
        .maybeSingle();

      if (existingNotification) {
        console.log(`[notify_only] Skipping ${card.id} - already notified via outbox (payment_method_id match)`);
        continue;
      }

      // Also check telegram_logs by payment_method_id
      const { data: existingLog } = await supabase
        .from('telegram_logs')
        .select('id')
        .eq('user_id', card.user_id)
        .eq('action', 'card_not_suitable_for_autopay')
        .eq('status', 'success')
        .filter('meta->>payment_method_id', 'eq', card.id) // PATCH B: Check by payment_method_id
        .gt('created_at', checkedAt)
        .limit(1)
        .maybeSingle();

      if (existingLog) {
        console.log(`[notify_only] Skipping ${card.id} - already notified via telegram_logs (payment_method_id match)`);
        continue;
      }

      cardsToNotify.push(card as RejectedCardForNotification);
    }

    // DRY RUN for notify_only
    if (dryRun) {
      return new Response(JSON.stringify({
        mode: 'dry_run',
        notify_only: true,
        would_notify: cardsToNotify.length,
        total_rejected: rejectedCards.length,
        already_notified: rejectedCards.length - cardsToNotify.length,
        cards: cardsToNotify.map(c => ({
          id: c.id,
          user_id: c.user_id,
          brand: c.brand,
          last4: c.last4,
          checked_at: c.verification_checked_at,
        })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // EXECUTE notify_only
    const startedAt = new Date().toISOString();
    let notifiedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    const skippedCount = rejectedCards.length - cardsToNotify.length;

    for (const card of cardsToNotify) {
      try {
        await sendNotification(
          supabaseUrl, 
          supabaseServiceKey, 
          card.user_id, 
          'card_not_suitable_for_autopay',
          { 
            id: card.id, 
            brand: card.brand, 
            last4: card.last4,
            // PATCH A: Pass verification_checked_at for idempotency key
            verification_checked_at: card.verification_checked_at,
          }
        );
        notifiedCount++;
        console.log(`[notify_only] Sent notification for ${card.id} to user ${card.user_id}`);
        
        // Rate limit protection: small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`[notify_only] Failed to notify for ${card.id}:`, e);
        errors.push(card.id);
        failedCount++;
      }
    }

    const finishedAt = new Date().toISOString();
    const remaining = cardsToNotify.length - notifiedCount;

    // PATCH C2: Write backfill summary to audit_logs (SYSTEM ACTOR)
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'payment-method-verify-recurring',
      action: 'card.notifications.backfill.completed',
      meta: {
        total_rejected: rejectedCards.length,
        sent: notifiedCount,
        skipped: skippedCount,
        failed: failedCount,
        remaining,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    });

    return new Response(JSON.stringify({
      mode: 'execute',
      notify_only: true,
      notified: notifiedCount,
      failed: failedCount,
      skipped: skippedCount,
      remaining,
      errors,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ===========================================================================
  // NORMAL MODE: Process verification jobs
  // ===========================================================================

  // SELECT pending jobs ready for processing
  const { data: jobs, error: fetchError } = await supabase
    .from('payment_method_verification_jobs')
    .select('id, payment_method_id, user_id, attempt_count, max_attempts, status, idempotency_key')
    .in('status', ['pending', 'rate_limited'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchError) {
    console.error('[payment-method-verify-recurring] Error fetching jobs:', fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({
      mode: dryRun ? 'dry_run' : 'execute',
      message: 'No pending jobs found',
      processed: 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // DRY RUN mode - just return what would be processed
  if (dryRun) {
    return new Response(JSON.stringify({
      mode: 'dry_run',
      would_process: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        payment_method_id: j.payment_method_id,
        user_id: j.user_id,
        attempt: j.attempt_count,
        status: j.status,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Get bePaid credentials
  const { data: bepaidConfig } = await supabase
    .from('integration_instances')
    .select('config')
    .eq('provider', 'bepaid')
    .in('status', ['active', 'connected'])
    .maybeSingle();

  const secretKey = bepaidConfig?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
  const shopId = bepaidConfig?.config?.shop_id || Deno.env.get('BEPAID_SHOP_ID') || '33524';
  
  // FIX #1: Get test_mode from config or ENV (NOT hardcoded!)
  const testMode = bepaidConfig?.config?.test_mode ?? (Deno.env.get('BEPAID_TEST_MODE') === 'true');
  console.log(`[payment-method-verify-recurring] bePaid config: shop=${shopId}, testMode=${testMode}`);
  
  if (!secretKey) {
    console.error('[payment-method-verify-recurring] No bePaid secret key configured');
    return new Response(JSON.stringify({ error: 'bePaid not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const bepaidAuth = btoa(`${shopId}:${secretKey}`);

  // EXECUTE mode - process jobs
  const results: ProcessingResult = {
    verified: 0,
    rejected: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    notified: 0,
    errors: [],
  };

  let rateLimitHit = false;

  for (const job of jobs as VerificationJob[]) {
    // Stop if rate limit was hit
    if (rateLimitHit) {
      console.log(`[payment-method-verify-recurring] Rate limit hit, stopping batch`);
      break;
    }

    try {
      // FIX #2: Lock job with affected rows check
      const { data: lockData, error: lockError } = await supabase
        .from('payment_method_verification_jobs')
        .update({ status: 'processing', updated_at: now })
        .eq('id', job.id)
        .eq('status', job.status)
        .select('id');

      if (lockError) {
        console.error(`[job ${job.id}] Lock error:`, lockError);
        results.errors.push(job.id);
        continue;
      }

      // FIX #2: Check if we actually locked the row (prevent race condition)
      if (!lockData || lockData.length === 0) {
        console.log(`[job ${job.id}] Already claimed by another worker, skipping`);
        results.skipped++;
        continue;
      }

      // Get payment method
      const { data: pm } = await supabase
        .from('payment_methods')
        .select('id, provider_token, last4, brand, user_id')
        .eq('id', job.payment_method_id)
        .single();

      if (!pm?.provider_token) {
        // Mark as failed - no token
        await finalizeJob(supabase, job, 'failed', 'No payment token found');
        await updatePaymentMethodStatus(supabase, job.payment_method_id, 'failed', 'Токен карты не найден');
        results.failed++;
        continue;
      }

      // Test charge: 1 BYN (100 kopecks)
      const testAmount = 100;
      const testCurrency = 'BYN';
      const trackingId = `verify_${pm.id}_${Date.now()}`;

      const chargePayload = {
        request: {
          amount: testAmount,
          currency: testCurrency,
          description: 'Проверка карты для автоплатежей (будет возвращено)',
          tracking_id: trackingId,
          test: testMode, // FIX #1: From config, NOT hardcoded
          skip_three_d_secure_verification: true, // Try to skip 3DS
          credit_card: { token: pm.provider_token },
          additional_data: {
            contract: ['recurring', 'unscheduled'],
            card_on_file: { initiator: 'merchant', type: 'delayed_charge' },
          },
        },
      };

      console.log(`[job ${job.id}] Attempting test charge for card ${pm.brand} ****${pm.last4}, testMode=${testMode}`);

      const chargeResp = await fetch('https://gateway.bepaid.by/transactions/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${bepaidAuth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-API-Version': '2',
        },
        body: JSON.stringify(chargePayload),
      });

      const httpStatus = chargeResp.status;
      const chargeResult = await chargeResp.json();
      const txStatus = chargeResult.transaction?.status;
      const txCode = chargeResult.transaction?.code;
      const txUid = chargeResult.transaction?.uid;
      const txMessage = chargeResult.transaction?.message || chargeResult.message;

      console.log(`[job ${job.id}] Charge result: http=${httpStatus}, status=${txStatus}, code=${txCode}, uid=${txUid}`);

      // FIX #5: Build raw response for audit logs
      const rawChargeResponse = {
        http_status: httpStatus,
        tx_status: txStatus,
        tx_code: txCode,
        tx_message: txMessage,
        tx_uid: txUid,
      };

      // === CASE A: SUCCESS → Refund ===
      if (txStatus === 'successful') {
        console.log(`[job ${job.id}] Test charge successful, initiating refund`);

        // Attempt refund
        const refundPayload = {
          request: {
            parent_uid: txUid,
            amount: testAmount,
            reason: 'Проверка карты: возврат',
          },
        };

        const refundResp = await fetch('https://gateway.bepaid.by/transactions/refunds', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${bepaidAuth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Version': '2',
          },
          body: JSON.stringify(refundPayload),
        });

        const refundHttpStatus = refundResp.status;
        const refundResult = await refundResp.json();
        const refundOk = refundResult.transaction?.status === 'successful';
        const refundUid = refundResult.transaction?.uid;
        const refundCode = refundResult.transaction?.code;
        const refundMessage = refundResult.transaction?.message;

        console.log(`[job ${job.id}] Refund result: ok=${refundOk}, uid=${refundUid}`);

        // FIX #5: Raw refund response
        const rawRefundResponse = {
          http_status: refundHttpStatus,
          tx_status: refundResult.transaction?.status,
          tx_code: refundCode,
          tx_message: refundMessage,
          tx_uid: refundUid,
        };

        // Update payment_method as verified (even if refund failed - charge worked!)
        await supabase.from('payment_methods').update({
          recurring_verified: true,
          verification_status: 'verified',
          verification_checked_at: new Date().toISOString(),
          verification_tx_uid: txUid,
          verification_error: refundOk ? null : `Refund pending: ${refundMessage || 'unknown'}`,
        }).eq('id', pm.id);

        // Mark job done
        await supabase.from('payment_method_verification_jobs').update({
          status: 'done',
          charge_tx_uid: txUid,
          refund_tx_uid: refundUid,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        // SYSTEM ACTOR audit with raw response (FIX #5)
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.verified',
          meta: {
            payment_method_id: pm.id,
            user_id: pm.user_id,
            last4: pm.last4,
            brand: pm.brand,
            charge_tx_uid: txUid,
            refund_tx_uid: refundUid,
            refund_status: refundResult.transaction?.status,
            raw: {
              charge: rawChargeResponse,
              refund: rawRefundResponse,
            },
          },
        });

        // If refund failed, log separately for manual follow-up
        if (!refundOk) {
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.refund.failed',
            meta: {
              payment_method_id: pm.id,
              charge_tx_uid: txUid,
              refund_error: refundMessage,
              requires_manual_refund: true,
              raw: rawRefundResponse,
            },
          });
        }

        results.verified++;

        // ========== AUTO-LINK to subscriptions ==========
        // Link verified card to orphan subscriptions (auto_renew=true, payment_method_id=null)
        try {
          const { data: orphanSubs } = await supabase
            .from('subscriptions_v2')
            .select('id')
            .eq('user_id', pm.user_id)
            .in('status', ['active', 'trial'])
            .eq('auto_renew', true)
            .is('payment_method_id', null);

          if (orphanSubs && orphanSubs.length > 0) {
            const subIds = orphanSubs.map(s => s.id);
            await supabase
              .from('subscriptions_v2')
              .update({
                payment_method_id: pm.id,
                payment_token: pm.provider_token,
              })
              .in('id', subIds);

            console.log(`[job ${job.id}] Auto-linked ${subIds.length} subscriptions to verified card`);

            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'payment-method-verify-recurring',
              action: 'subscription.payment_method_auto_linked',
              meta: {
                payment_method_id: pm.id,
                user_id: pm.user_id,
                subscriptions_linked: subIds,
                count: subIds.length,
              },
            });
          }
        } catch (linkError) {
          console.error(`[job ${job.id}] Auto-link error:`, linkError);
        }
      }

      // === CASE B: 3DS Required → Rejected ===
      else if (txStatus === 'incomplete' && REQUIRES_3DS_CODES.includes(txCode)) {
        console.log(`[job ${job.id}] Card requires 3DS: ${txCode}`);

        await supabase.from('payment_methods').update({
          recurring_verified: false,
          verification_status: 'rejected',
          verification_checked_at: new Date().toISOString(),
          verification_error: 'Карта требует 3D-Secure на каждую операцию',
        }).eq('id', pm.id);

        await supabase.from('payment_method_verification_jobs').update({
          status: 'done',
          last_error: `3DS required: ${txCode}`,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        // SYSTEM ACTOR audit with raw response (FIX #5)
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.rejected',
          meta: {
            payment_method_id: pm.id,
            user_id: pm.user_id,
            last4: pm.last4,
            brand: pm.brand,
            code: txCode,
            reason: '3ds_required',
            raw: rawChargeResponse,
          },
        });

        // FIX C1: Send notification for REJECTED (3DS required) - use card_not_suitable_for_autopay
        try {
          await sendNotification(
            supabaseUrl, 
            supabaseServiceKey, 
            pm.user_id, 
            'card_not_suitable_for_autopay',
            { id: pm.id, brand: pm.brand, last4: pm.last4 }
          );
          results.notified++;
        } catch (notifyError) {
          console.error(`[job ${job.id}] Failed to send rejection notification:`, notifyError);
        }

        results.rejected++;
      }

      // === CASE C: Rate limit → Stop batch ===
      else if (txCode === 'G.9999' || httpStatus === 429) {
        console.log(`[job ${job.id}] Rate limit hit: ${txCode}`);
        rateLimitHit = true;

        // Revert to pending with next_retry_at
        const nextRetry = new Date(Date.now() + 300000).toISOString(); // 5 min
        await supabase.from('payment_method_verification_jobs').update({
          status: 'rate_limited',
          next_retry_at: nextRetry,
          last_error: 'Rate limited',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.rate_limited',
          meta: { job_id: job.id, next_retry_at: nextRetry, raw: rawChargeResponse },
        });
      }

      // === CASE D: Other error → Retry with backoff ===
      else {
        const newAttempt = job.attempt_count + 1;
        const maxAttempts = job.max_attempts || 5;

        console.log(`[job ${job.id}] Charge failed: ${txStatus}/${txCode}/${txMessage}, attempt ${newAttempt}/${maxAttempts}`);

        if (newAttempt >= maxAttempts) {
          // Final failure
          await supabase.from('payment_methods').update({
            verification_status: 'failed',
            verification_error: txMessage || 'Max attempts exceeded',
            verification_checked_at: new Date().toISOString(),
          }).eq('id', pm.id);

          await supabase.from('payment_method_verification_jobs').update({
            status: 'failed',
            attempt_count: newAttempt,
            last_error: txMessage,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);

          // Audit with raw response (FIX #5)
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.verification.failed',
            meta: {
              payment_method_id: pm.id,
              user_id: pm.user_id,
              attempts: newAttempt,
              last_error: txMessage,
              code: txCode,
              raw: rawChargeResponse,
            },
          });

          // FIX C2: Send notification for FAILED (not 3DS) - use card_verification_failed
          try {
            await sendNotification(
              supabaseUrl, 
              supabaseServiceKey, 
              pm.user_id, 
              'card_verification_failed',
              { id: pm.id, brand: pm.brand, last4: pm.last4 }
            );
            results.notified++;
          } catch (notifyError) {
            console.error(`[job ${job.id}] Failed to send failure notification:`, notifyError);
          }

          results.failed++;
        } else {
          // Retry with backoff
          const backoffMs = calculateBackoff(newAttempt);
          const nextRetry = new Date(Date.now() + backoffMs).toISOString();

          await supabase.from('payment_method_verification_jobs').update({
            status: 'pending',
            attempt_count: newAttempt,
            next_retry_at: nextRetry,
            last_error: txMessage,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);

          console.log(`[job ${job.id}] Scheduled retry at ${nextRetry}`);
          results.retried++;
        }
      }

      // Small delay between jobs to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (jobError) {
      console.error(`[job ${job.id}] Unexpected error:`, jobError);
      results.errors.push(job.id);

      // Revert job to pending for retry
      await supabase.from('payment_method_verification_jobs').update({
        status: 'pending',
        last_error: jobError instanceof Error ? jobError.message : 'Unknown error',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
    }
  }

  console.log(`[payment-method-verify-recurring] Completed: verified=${results.verified}, rejected=${results.rejected}, retried=${results.retried}, failed=${results.failed}, skipped=${results.skipped}, notified=${results.notified}`);

  // SYSTEM ACTOR: Log successful cron run
  await supabase.from('audit_logs').insert({
    actor_type: 'system',
    actor_user_id: null,
    actor_label: 'payment-method-verify-recurring',
    action: 'cron.run',
    meta: {
      run_id: crypto.randomUUID(),
      source: body.source || 'unknown',
      mode: dryRun ? 'dry_run' : 'execute',
      limit,
      finished_at: new Date().toISOString(),
      processed: results.verified + results.rejected + results.retried + results.failed + results.skipped,
      verified: results.verified,
      rejected: results.rejected,
      retried: results.retried,
      failed: results.failed,
      skipped: results.skipped,
      notified: results.notified,
      rate_limit_hit: rateLimitHit,
    },
  });

  return new Response(JSON.stringify({
    mode: 'execute',
    processed: jobs.length,
    results,
    rate_limit_hit: rateLimitHit,
    test_mode: testMode,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

// Helper: Finalize job with status
async function finalizeJob(
  supabase: any,
  job: VerificationJob,
  status: string,
  error: string
) {
  await supabase.from('payment_method_verification_jobs').update({
    status,
    last_error: error,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
}

// Helper: Update payment method verification status
async function updatePaymentMethodStatus(
  supabase: any,
  pmId: string,
  status: string,
  error: string
) {
  await supabase.from('payment_methods').update({
    verification_status: status,
    verification_error: error,
    verification_checked_at: new Date().toISOString(),
  }).eq('id', pmId);
}

// FIX #3: Send notification via telegram-send-notification edge function (NOT direct Telegram API)
// FIX C: Different message_type for rejected (3DS) vs failed (error)
async function sendNotification(
  supabaseUrl: string,
  supabaseServiceKey: string,
  userId: string,
  messageType: 'card_not_suitable_for_autopay' | 'card_verification_failed',
  paymentMethodMeta: { id: string; brand: string; last4: string; verification_checked_at?: string | null }
) {
  // SECURITY: Do NOT pass custom_message - let the edge function use its secure template
  const resp = await fetch(`${supabaseUrl}/functions/v1/telegram-send-notification`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      message_type: messageType,
      // Pass card info for template substitution (NOT custom_message!)
      payment_method_meta: paymentMethodMeta,
    }),
  });

  const result = await resp.json();
  if (result.success) {
    console.log(`[notification] Sent ${messageType} to user ${userId} via telegram-send-notification`);
  } else if (result.skipped) {
    console.log(`[notification] Skipped ${messageType} for user ${userId}: ${result.error}`);
  } else {
    console.error(`[notification] telegram-send-notification failed for ${userId}:`, result.error);
  }
  
  return result;
}
