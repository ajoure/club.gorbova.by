import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPayment } from "../_shared/paymentClassification.ts";

/**
 * PATCH-E: Backfill payment_classification for legacy payments
 * 
 * Features:
 * - Batch processing (500 per run, configurable)
 * - Dry-run mode for preview
 * - SYSTEM ACTOR audit logging
 * - Idempotent (safe to run multiple times)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillResult {
  success: boolean;
  mode: 'dry_run' | 'execute';
  processed: number;
  remaining: number;
  duration_ms: number;
  samples: Array<{
    id: string;
    current: string | null;
    new: string;
    transaction_type: string | null;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Require authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse options
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // Default to dry_run=true for safety
    const batchSize = Math.min(body.batch_size || 500, 1000); // Max 1000
    const fromDate = body.from_date || '2026-01-01';

    console.log(`[BACKFILL] Starting (dry_run=${dryRun}, batch=${batchSize}, from=${fromDate})`);

    // Get unclassified payments
    // Note: is_trial, description don't exist on payments_v2, check via meta
    // PATCH-4: Added amount and currency for 1 BYN card verification rule
    const { data: payments, error: fetchError } = await supabase
      .from('payments_v2')
      .select('id, status, transaction_type, order_id, is_recurring, product_name_raw, meta, amount, currency')
      .is('payment_classification', null)
      .gte('created_at', fromDate)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchError) {
      throw fetchError;
    }

    // Count remaining
    const { count: remainingCount } = await supabase
      .from('payments_v2')
      .select('*', { count: 'exact', head: true })
      .is('payment_classification', null)
      .gte('created_at', fromDate);

    const samples: BackfillResult['samples'] = [];
    let processedCount = 0;

    for (const payment of payments || []) {
      const classification = classifyPayment({
        status: payment.status,
        transaction_type: payment.transaction_type,
        order_id: payment.order_id,
        is_recurring: payment.is_recurring,
        is_trial: payment.meta?.is_trial || false,
        description: payment.product_name_raw, // Use product_name_raw as description
        meta: payment.meta,
        amount: payment.amount,
        currency: payment.currency,
      });

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('payments_v2')
          .update({ payment_classification: classification })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`[BACKFILL] Failed to update ${payment.id}:`, updateError);
          continue;
        }
      }

      processedCount++;

      // Keep first 10 samples for reporting
      if (samples.length < 10) {
        samples.push({
          id: payment.id,
          current: null,
          new: classification,
          transaction_type: payment.transaction_type,
        });
      }
    }

    const result: BackfillResult = {
      success: true,
      mode: dryRun ? 'dry_run' : 'execute',
      processed: processedCount,
      remaining: (remainingCount || 0) - processedCount,
      duration_ms: Date.now() - startTime,
      samples,
    };

    // Audit log (only on execute)
    if (!dryRun && processedCount > 0) {
      await supabase.from('audit_logs').insert({
        action: 'backfill.payment_classification',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'backfill-payment-classification',
        meta: {
          processed: processedCount,
          remaining: result.remaining,
          batch_size: batchSize,
          from_date: fromDate,
          duration_ms: result.duration_ms,
        },
      });
    }

    console.log(`[BACKFILL] ${dryRun ? 'DRY-RUN' : 'EXECUTED'}: ${processedCount} payments, ${result.remaining} remaining`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BACKFILL] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
