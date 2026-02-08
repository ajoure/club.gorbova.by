import { createClient } from "npm:@supabase/supabase-js@2";
import { getBepaidCredsStrict, isBepaidCredsError, createBepaidAuthHeader } from "../_shared/bepaid-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Build stamp for deployment verification - MUST appear in ALL responses and audit_logs
const BUILD_STAMP = 'pm-verify-p0-security-2026-02-08';

// PATCH P0: Helper that ALWAYS includes build_stamp in JSON responses
function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({
    ...payload,
    build_stamp: BUILD_STAMP,
  }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 3DS-related error codes from bePaid that indicate card requires 3DS for each transaction
const REQUIRES_3DS_CODES = ['P.4011', 'P.4012', 'P.4013', 'P.4014', 'P.4015'];

// Rate limit / temporary error codes that should trigger retry
const RETRIABLE_CODES = ['G.9999', 'N.1001', 'N.1002', 'N.1003'];

// Bank decline messages that indicate card is NOT suitable for MIT (not retryable)
const BANK_DECLINE_PATTERNS = [
  'do not honor',
  'do_not_honor',
  'decline',
  'declined',
  'отказано',
  'insufficient funds',
  'недостаточно средств',
];

// Bank decline codes that are NOT retryable
const BANK_DECLINE_CODES = ['05', '51', '61', '04', '14'];

// Helper: Check if error is a bank decline (not retryable)
function isBankDecline(message: string | undefined, code: string | undefined): boolean {
  if (!message && !code) return false;
  
  const msgLower = (message || '').toLowerCase();
  const codeStr = (code || '').toString();
  
  // Check message patterns
  if (BANK_DECLINE_PATTERNS.some(pattern => msgLower.includes(pattern))) {
    return true;
  }
  
  // Check decline codes
  if (BANK_DECLINE_CODES.includes(codeStr)) {
    return true;
  }
  
  return false;
}

// Helper: Extract gateway message from various response formats
function extractGatewayMessage(httpStatus: number, json: any, rawText?: string): string {
  const txMessage = json?.transaction?.message;
  const respMessage = json?.message;
  const respError = json?.error;
  
  if (txMessage) return txMessage;
  if (respMessage) return respMessage;
  if (respError) return typeof respError === 'string' ? respError : JSON.stringify(respError);
  if (rawText && rawText.length < 200) return rawText;
  
  return `HTTP ${httpStatus}`;
}

// PATCH-2: Helper to get existing meta and merge (prevent data loss)
async function getExistingMeta(supabase: any, pmId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('payment_methods')
    .select('meta')
    .eq('id', pmId)
    .single();
  return (data?.meta as Record<string, unknown>) || {};
}

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

Deno.serve(async (req) => {
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
        // Also check superadmin (correct enum value without underscore)
        const { data: superAdminCheck } = await supabase
          .rpc('has_role', { _user_id: user.id, _role: 'superadmin' });
        
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
    return jsonResponse({ error: 'Unauthorized' }, 401);
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
      return jsonResponse({ error: fetchRejectedError.message }, 500);
    }

    if (!rejectedCards || rejectedCards.length === 0) {
      return jsonResponse({
        mode: dryRun ? 'dry_run' : 'execute',
        notify_only: true,
        message: 'No rejected cards found for notification',
        count: 0,
      });
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
      return jsonResponse({
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
      });
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

    return jsonResponse({
      mode: 'execute',
      notify_only: true,
      notified: notifiedCount,
      failed: failedCount,
      skipped: skippedCount,
      remaining,
      errors,
    });
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
    return jsonResponse({ error: fetchError.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return jsonResponse({
      mode: dryRun ? 'dry_run' : 'execute',
      message: 'No pending jobs found',
      processed: 0,
    });
  }

  // DRY RUN mode - just return what would be processed
  if (dryRun) {
    return jsonResponse({
      mode: 'dry_run',
      would_process: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id,
        payment_method_id: j.payment_method_id,
        user_id: j.user_id,
        attempt: j.attempt_count,
        status: j.status,
      })),
    });
  }

  // PATCH-D: Get bePaid credentials STRICTLY from integration_instances (NO env fallback)
  const credsResult = await getBepaidCredsStrict(supabase);
  
  if (isBepaidCredsError(credsResult)) {
    console.error('[payment-method-verify-recurring] bePaid credentials error:', credsResult.error);
    return jsonResponse({ 
      error: credsResult.error,
      code: credsResult.code 
    }, 500);
  }

  const bepaidCreds = credsResult;
  const testMode = bepaidCreds.test_mode;
  console.log(`[payment-method-verify-recurring] bePaid config: testMode=${testMode}, creds_source=${bepaidCreds.creds_source}`);

  const bepaidAuth = createBepaidAuthHeader(bepaidCreds);

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

      // ========== LEDGER: Create payments_v2 record BEFORE charge ==========
      // Get profile_id for the user
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', pm.user_id)
        .single();

      const { data: ledgerPayment, error: ledgerError } = await supabase
        .from('payments_v2')
        .insert({
          amount: 1.00, // 1 BYN
          currency: testCurrency,
          status: 'processing',
          provider: 'bepaid',
          origin: 'card_verification',
          payment_classification: 'card_verification',
          transaction_type: 'tokenization',
          user_id: pm.user_id,
          profile_id: profileData?.id || null,
          meta: {
            payment_method_id: pm.id,
            verify_tracking_id: trackingId,
            is_verification: true,
            card_last4: pm.last4,
            card_brand: pm.brand,
            attempt: job.attempt_count + 1, // PATCH-3: Track attempt number
            job_id: job.id, // PATCH-3: Track job for audit trail
          },
        })
        .select('id')
        .single();

      if (ledgerError) {
        console.error(`[job ${job.id}] Failed to create ledger payment:`, ledgerError);
      } else {
        console.log(`[job ${job.id}] Created ledger payment ${ledgerPayment?.id} for verification`);
      }

      // ========== SYSTEM ACTOR audit: verification started ==========
      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'payment-method-verify-recurring',
        action: 'card.verification.started',
        meta: {
          build_stamp: BUILD_STAMP, // P0: Always include build_stamp
          payment_method_id: pm.id,
          job_id: job.id,
          tracking_id: trackingId,
          ledger_payment_id: ledgerPayment?.id,
        },
      });

      const chargePayload = {
        request: {
          amount: testAmount,
          currency: testCurrency,
          description: 'Проверка карты для автоплатежей (будет возвращено)',
          tracking_id: trackingId,
          test: testMode,
          // REMOVED: skip_three_d_secure_verification - let 3DS work properly to detect cards that require it
          credit_card: { token: pm.provider_token },
          additional_data: {
            contract: ['recurring', 'unscheduled'],
            card_on_file: { initiator: 'merchant', type: 'delayed_charge' },
          },
        },
      };

      console.log(`[job ${job.id}] Attempting test charge for card ${pm.brand} ****${pm.last4}, testMode=${testMode}`);

      let chargeResp: Response;
      let chargeResult: any;
      let httpStatus: number;
      let rawChargeText: string;
      
      try {
        chargeResp = await fetch('https://gateway.bepaid.by/transactions/payments', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${bepaidAuth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Version': '2',
          },
          body: JSON.stringify(chargePayload),
        });
        
        httpStatus = chargeResp.status;
        rawChargeText = await chargeResp.text();
        
        // Safe JSON parse
        try {
          chargeResult = JSON.parse(rawChargeText);
        } catch {
          chargeResult = { message: rawChargeText.slice(0, 200) };
        }
      } catch (fetchError) {
        // Network error - treat as retryable gateway error
        console.error(`[job ${job.id}] Network error:`, fetchError);
        httpStatus = 0;
        chargeResult = { message: fetchError instanceof Error ? fetchError.message : 'Network error' };
        rawChargeText = '';
      }

      const txStatus = chargeResult?.transaction?.status;
      const txCode = chargeResult?.transaction?.code;
      const txUid = chargeResult?.transaction?.uid;
      const txMessage = extractGatewayMessage(httpStatus, chargeResult, rawChargeText);

      console.log(`[job ${job.id}] Charge result: http=${httpStatus}, status=${txStatus}, code=${txCode}, uid=${txUid}, msg=${txMessage?.slice(0, 100)}`);

      // PATCH-4: Removed rawChargeResponse object - no longer needed for audit

      // ============================================================
      // PATCH-2: BANK DECLINE CHECK (not retryable) — Do not honor, etc.
      // ============================================================
      const bankDecline = isBankDecline(txMessage, txCode);
      
      if (bankDecline) {
        console.log(`[job ${job.id}] Bank decline detected: ${txMessage}`);
        
        // Update ledger to failed
        if (ledgerPayment?.id) {
          await supabase.from('payments_v2').update({
            status: 'failed',
            error_message: `bank_decline: ${txMessage?.slice(0, 100) || 'declined'}`,
          }).eq('id', ledgerPayment.id);
        }
        
        // PATCH-2: Merge existing meta to prevent data loss
        const existingMeta = await getExistingMeta(supabase, pm.id);
        
        // Update payment method to rejected (NOT retryable)
        await supabase.from('payment_methods').update({
          verification_status: 'rejected',
          verification_error: `Карта отклонена банком: ${txMessage?.slice(0, 100) || 'отказано'}`,
          verification_checked_at: new Date().toISOString(),
          recurring_verified: false,
          meta: {
            ...existingMeta, // Preserve existing meta fields
            verify_tracking_id: trackingId,
            verify_payment_id: ledgerPayment?.id,
            rejection_reason: 'bank_decline',
            bank_message: txMessage?.slice(0, 200),
          },
        }).eq('id', pm.id);
        
        // Close job as failed
        await supabase.from('payment_method_verification_jobs').update({
          status: 'failed',
          last_error: `bank_decline: ${txMessage}`,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        
        // SYSTEM ACTOR audit: card.verification.rejected (PATCH-1: no raw)
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.rejected',
          meta: {
            build_stamp: BUILD_STAMP, // P0: Always include build_stamp
            payment_method_id: pm.id,
            user_id: pm.user_id,
            last4: pm.last4,
            brand: pm.brand,
            reason: 'bank_decline',
            message_short: txMessage?.slice(0, 120),
            ledger_payment_id: ledgerPayment?.id,
            http_status: httpStatus,
            tx_uid: txUid,
            tx_code: txCode,
          },
        });
        
        // Send notification
        try {
          await sendNotification(supabaseUrl, supabaseServiceKey, pm.user_id, 
            'card_not_suitable_for_autopay', { id: pm.id, brand: pm.brand, last4: pm.last4 });
          results.notified++;
        } catch (e) {
          console.error(`[job ${job.id}] Notification failed:`, e);
        }
        
        results.rejected++;
        continue; // Next job
      }
      
      // ============================================================
      // PATCH-1: HTTP 500 / GATEWAY ERROR HANDLING (retryable but finalize ledger)
      // ============================================================
      if (httpStatus >= 500 || httpStatus === 0 || !chargeResult?.transaction) {
        console.log(`[job ${job.id}] Gateway error: http=${httpStatus}, no transaction`);
        
        // Update ledger to failed IMMEDIATELY (don't leave in processing)
        if (ledgerPayment?.id) {
          await supabase.from('payments_v2').update({
            status: 'failed',
            error_message: `gateway_error: HTTP ${httpStatus} - ${txMessage?.slice(0, 100) || 'no response'}`,
          }).eq('id', ledgerPayment.id);
        }
        
        const newAttempt = job.attempt_count + 1;
        const maxAttempts = job.max_attempts || 5;
        
        if (newAttempt >= maxAttempts) {
          // Max attempts exhausted → finalize as failed
          // PATCH-2: Merge existing meta
          const existingMeta = await getExistingMeta(supabase, pm.id);
          
          await supabase.from('payment_methods').update({
            verification_status: 'failed',
            verification_error: `Ошибка шлюза после ${newAttempt} попыток: ${txMessage?.slice(0, 100) || 'нет ответа'}`,
            verification_checked_at: new Date().toISOString(),
            meta: {
              ...existingMeta,
              rejection_reason: 'gateway_error_max_attempts',
              verify_payment_id: ledgerPayment?.id,
              last_error: txMessage?.slice(0, 200),
            },
          }).eq('id', pm.id);
          
          await supabase.from('payment_method_verification_jobs').update({
            status: 'failed',
            attempt_count: newAttempt,
            last_error: `gateway_error_max_attempts: HTTP ${httpStatus}`,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          
          // SYSTEM ACTOR audit (PATCH-1: no raw)
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.verification.failed',
            meta: {
              build_stamp: BUILD_STAMP, // P0: Always include build_stamp
              payment_method_id: pm.id,
              user_id: pm.user_id,
              reason: 'gateway_error_max_attempts',
              attempts: newAttempt,
              http_status: httpStatus,
              message_short: txMessage?.slice(0, 120),
              ledger_payment_id: ledgerPayment?.id,
              tx_uid: txUid,
              tx_code: txCode,
            },
          });
          
          results.failed++;
        } else {
          // Schedule retry (but ledger already failed for THIS attempt)
          const backoffMs = calculateBackoff(newAttempt);
          const nextRetry = new Date(Date.now() + backoffMs).toISOString();
          
          await supabase.from('payment_method_verification_jobs').update({
            status: 'pending',
            attempt_count: newAttempt,
            next_retry_at: nextRetry,
            last_error: `gateway_error: HTTP ${httpStatus}`,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          
          // SYSTEM ACTOR audit: retry scheduled (PATCH-1: no raw)
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.verification.retry_scheduled',
            meta: {
              build_stamp: BUILD_STAMP, // P0: Always include build_stamp
              payment_method_id: pm.id,
              job_id: job.id,
              reason: 'gateway_error',
              attempt: newAttempt,
              next_retry_at: nextRetry,
              http_status: httpStatus,
              message_short: txMessage?.slice(0, 120),
            },
          });
          
          results.retried++;
        }
        
        continue; // Next job
      }

      // === CASE A: SUCCESS → Refund ===
      if (txStatus === 'successful') {
        console.log(`[job ${job.id}] Test charge successful, initiating refund`);

        // ========== LEDGER: Update charge payment to succeeded ==========
        if (ledgerPayment?.id) {
          await supabase.from('payments_v2').update({
            status: 'succeeded',
            provider_payment_id: txUid,
            paid_at: new Date().toISOString(),
          }).eq('id', ledgerPayment.id);
        }

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

        // PATCH-4: Removed rawRefundResponse object - no longer needed for audit

        // ========== LEDGER: Create refund record in payments_v2 ==========
        const refundStatus = refundOk ? 'refunded' : 'processing';
        await supabase.from('payments_v2').insert({
          amount: 1.00,
          currency: testCurrency,
          status: refundStatus,
          provider: 'bepaid',
          origin: 'card_verification',
          payment_classification: 'card_verification',
          transaction_type: 'refund',
          user_id: pm.user_id,
          profile_id: profileData?.id || null,
          provider_payment_id: refundUid,
          reference_payment_id: ledgerPayment?.id || null,
          meta: {
            payment_method_id: pm.id,
            is_verification_refund: true,
            parent_charge_uid: txUid,
            needs_review: !refundOk,
          },
        });

        // Determine final verification status
        const finalStatus = refundOk ? 'verified' : 'verified_refund_pending';

        // PATCH-2: Merge existing meta
        const existingMetaVerified = await getExistingMeta(supabase, pm.id);
        
        // Update payment_method
        await supabase.from('payment_methods').update({
          recurring_verified: true,
          verification_status: finalStatus,
          verification_checked_at: new Date().toISOString(),
          verification_tx_uid: txUid,
          verification_error: refundOk ? null : `Refund pending: ${refundMessage || 'unknown'}`,
          meta: {
            ...existingMetaVerified,
            verify_charge_uid: txUid,
            verify_refund_uid: refundUid,
            verify_tracking_id: trackingId,
            verify_payment_id: ledgerPayment?.id,
          },
        }).eq('id', pm.id);

        // Mark job done
        await supabase.from('payment_method_verification_jobs').update({
          status: 'done',
          charge_tx_uid: txUid,
          refund_tx_uid: refundUid,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        // SYSTEM ACTOR audit (PATCH-1: no raw)
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.completed',
          meta: {
            build_stamp: BUILD_STAMP, // P0: Always include build_stamp
            payment_method_id: pm.id,
            user_id: pm.user_id,
            last4: pm.last4,
            brand: pm.brand,
            status: finalStatus,
            charge_tx_uid: txUid,
            refund_tx_uid: refundUid,
            refund_status: refundResult.transaction?.status,
            refund_http_status: refundHttpStatus,
            refund_code: refundCode,
            ledger_payment_id: ledgerPayment?.id,
          },
        });

        // If refund failed, log for manual follow-up (PATCH-1: no raw)
        if (!refundOk) {
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.refund.pending',
            meta: {
              build_stamp: BUILD_STAMP, // P0: Always include build_stamp
              payment_method_id: pm.id,
              charge_tx_uid: txUid,
              refund_uid: refundUid,
              refund_http_status: refundHttpStatus,
              refund_code: refundCode,
              refund_error: refundMessage?.slice(0, 120),
              needs_review: true,
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

        // ========== LEDGER: Update charge payment to failed ==========
        if (ledgerPayment?.id) {
          await supabase.from('payments_v2').update({
            status: 'failed',
            error_message: 'Карта требует 3D-Secure на каждую операцию',
          }).eq('id', ledgerPayment.id);
        }

        // PATCH-2: Merge existing meta for 3DS rejection
        const existingMeta3ds = await getExistingMeta(supabase, pm.id);
        
        await supabase.from('payment_methods').update({
          recurring_verified: false,
          verification_status: 'rejected_3ds_required',
          verification_checked_at: new Date().toISOString(),
          verification_error: 'Карта требует 3D-Secure на каждую операцию',
          meta: {
            ...existingMeta3ds,
            verify_tracking_id: trackingId,
            verify_payment_id: ledgerPayment?.id,
            rejection_code: txCode,
            rejection_reason: '3ds_required',
          },
        }).eq('id', pm.id);

        await supabase.from('payment_method_verification_jobs').update({
          status: 'done',
          last_error: `3DS required: ${txCode}`,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        // SYSTEM ACTOR audit (PATCH-1: no raw)
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.completed',
          meta: {
            build_stamp: BUILD_STAMP, // P0: Always include build_stamp
            payment_method_id: pm.id,
            user_id: pm.user_id,
            last4: pm.last4,
            brand: pm.brand,
            status: 'rejected_3ds_required',
            tx_code: txCode,
            reason: '3ds_required',
            ledger_payment_id: ledgerPayment?.id,
            http_status: httpStatus,
          },
        });

        // Send notification for REJECTED (3DS required)
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

        // PATCH-1: no raw in rate_limited audit
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'payment-method-verify-recurring',
          action: 'card.verification.rate_limited',
          meta: { 
            build_stamp: BUILD_STAMP, // P0: Always include build_stamp
            job_id: job.id, 
            next_retry_at: nextRetry, 
            http_status: httpStatus,
            tx_code: txCode,
          },
        });
      }

      // === CASE D: Other error → Retry with backoff ===
      else {
        const newAttempt = job.attempt_count + 1;
        const maxAttempts = job.max_attempts || 5;

        console.log(`[job ${job.id}] Charge failed: ${txStatus}/${txCode}/${txMessage}, attempt ${newAttempt}/${maxAttempts}`);

        if (newAttempt >= maxAttempts) {
          // PATCH-2: Merge existing meta for failed
          const existingMetaFailed = await getExistingMeta(supabase, pm.id);
          
          // Final failure
          await supabase.from('payment_methods').update({
            verification_status: 'failed',
            verification_error: txMessage?.slice(0, 200) || 'Max attempts exceeded',
            verification_checked_at: new Date().toISOString(),
            meta: {
              ...existingMetaFailed,
              rejection_reason: 'max_attempts_exceeded',
              verify_payment_id: ledgerPayment?.id,
              last_error: txMessage?.slice(0, 200),
            },
          }).eq('id', pm.id);

          await supabase.from('payment_method_verification_jobs').update({
            status: 'failed',
            attempt_count: newAttempt,
            last_error: txMessage,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);

          // PATCH-1: Audit without raw
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'payment-method-verify-recurring',
            action: 'card.verification.failed',
            meta: {
              build_stamp: BUILD_STAMP, // P0: Always include build_stamp
              payment_method_id: pm.id,
              user_id: pm.user_id,
              attempts: newAttempt,
              message_short: txMessage?.slice(0, 120),
              tx_code: txCode,
              http_status: httpStatus,
              ledger_payment_id: ledgerPayment?.id,
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
      build_stamp: BUILD_STAMP, // P0: Always include build_stamp
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

  return jsonResponse({
    mode: 'execute',
    processed: jobs.length,
    results,
    rate_limit_hit: rateLimitHit,
    test_mode: testMode,
  });
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
