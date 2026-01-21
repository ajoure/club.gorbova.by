import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MaterializeRequest {
  dry_run?: boolean;
  limit?: number;
  from_date?: string;
  to_date?: string;
  only_profile_id?: string;
  cursor_paid_at?: string;
  cursor_id?: string;
}

interface MaterializeResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    scanned: number;
    to_create: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  next_cursor: {
    paid_at: string | null;
    id: string | null;
  } | null;
  samples: Array<{
    queue_id: string;
    stable_uid: string;
    payment_id: string | null;
    result: 'created' | 'updated' | 'skipped' | 'error';
    error?: string;
  }>;
  warnings: string[];
  duration_ms: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: MaterializeRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(Math.max(body.limit || 200, 1), 1000);
    const fromDate = body.from_date;
    const toDate = body.to_date;
    const onlyProfileId = body.only_profile_id;
    const cursorPaidAt = body.cursor_paid_at;
    const cursorId = body.cursor_id;

    const result: MaterializeResult = {
      success: true,
      dry_run: dryRun,
      stats: {
        scanned: 0,
        to_create: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      },
      next_cursor: null,
      samples: [],
      warnings: [],
      duration_ms: 0,
    };

    // Use RPC to get ONLY unmaterialized queue items (ANTI-JOIN)
    // This is the critical fix: we select only records that DON'T exist in payments_v2
    const { data: unmaterializedItems, error: fetchError } = await supabase.rpc(
      'get_unmaterialized_queue_items',
      {
        p_limit: limit,
        p_from_date: fromDate || null,
        p_to_date: toDate || null,
        p_only_profile_id: onlyProfileId || null,
        p_cursor_paid_at: cursorPaidAt || null,
        p_cursor_id: cursorId || null,
      }
    );

    if (fetchError) {
      // Fallback: if RPC doesn't exist, use manual ANTI-JOIN approach
      console.log('RPC not available, using fallback approach:', fetchError.message);
      
      // Get all completed queue items
      let query = supabase
        .from('payment_reconcile_queue')
        .select('*')
        .eq('status', 'completed')
        .order('paid_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit * 3); // Fetch more to account for existing ones

      if (fromDate) {
        query = query.gte('paid_at', fromDate);
      }
      if (toDate) {
        query = query.lte('paid_at', toDate);
      }
      if (onlyProfileId) {
        query = query.eq('matched_profile_id', onlyProfileId);
      }
      if (cursorPaidAt && cursorId) {
        query = query.or(`paid_at.gt.${cursorPaidAt},and(paid_at.eq.${cursorPaidAt},id.gt.${cursorId})`);
      }

      const { data: allQueueItems, error: queueError } = await query;

      if (queueError) {
        throw new Error(`Failed to fetch queue: ${queueError.message}`);
      }

      if (!allQueueItems || allQueueItems.length === 0) {
        result.duration_ms = Date.now() - startTime;
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build stable_uids for batch check
      const stableUids = allQueueItems.map(item => 
        item.bepaid_uid || item.tracking_id || item.id
      ).filter(Boolean);

      // Get existing payments in one query
      const { data: existingPayments, error: existingError } = await supabase
        .from('payments_v2')
        .select('provider_payment_id')
        .in('provider_payment_id', stableUids);

      if (existingError) {
        throw new Error(`Failed to check existing: ${existingError.message}`);
      }

      const existingSet = new Set(existingPayments?.map(p => p.provider_payment_id) || []);

      // Filter to only unmaterialized items
      const filteredItems = allQueueItems.filter(item => {
        const stableUid = item.bepaid_uid || item.tracking_id || item.id;
        return stableUid && !existingSet.has(stableUid);
      }).slice(0, limit);

      // Process filtered items
      return await processItems(supabase, filteredItems, dryRun, result, startTime);
    }

    // RPC succeeded - process the already-filtered items
    return await processItems(supabase, unmaterializedItems || [], dryRun, result, startTime);

  } catch (error: any) {
    console.error('Materialize error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processItems(
  supabase: any,
  queueItems: any[],
  dryRun: boolean,
  result: MaterializeResult,
  startTime: number
): Promise<Response> {
  result.stats.scanned = queueItems.length;
  result.stats.to_create = queueItems.length;

  if (queueItems.length === 0) {
    result.duration_ms = Date.now() - startTime;
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Set next cursor from last item
  const lastItem = queueItems[queueItems.length - 1];
  result.next_cursor = {
    paid_at: lastItem.paid_at,
    id: lastItem.id,
  };

  // Process each item
  for (const queueItem of queueItems) {
    const stableUid = queueItem.bepaid_uid || queueItem.tracking_id || queueItem.id;
    
    if (!stableUid) {
      result.stats.skipped++;
      result.stats.to_create--;
      continue;
    }

    const mappedStatus = queueItem.status === 'completed' ? 'succeeded' : queueItem.status;
    
    const paymentData = {
      provider_payment_id: stableUid,
      provider: queueItem.provider || 'bepaid',
      amount: queueItem.amount,
      currency: queueItem.currency || 'BYN',
      status: mappedStatus,
      transaction_type: queueItem.transaction_type || 'payment',
      card_last4: queueItem.card_last4,
      card_brand: queueItem.card_brand,
      paid_at: queueItem.paid_at,
      profile_id: queueItem.matched_profile_id,
      order_id: queueItem.matched_order_id || queueItem.processed_order_id,
      receipt_url: queueItem.receipt_url,
      product_name_raw: queueItem.product_name,
      meta: {
        materialized_from_queue: true,
        queue_id: queueItem.id,
        materialized_at: new Date().toISOString(),
        original_queue_status: queueItem.status,
      },
    };

    if (dryRun) {
      // In dry-run mode, just count - these are all to_create since we pre-filtered
      result.stats.created++;
      if (result.samples.length < 10) {
        result.samples.push({
          queue_id: queueItem.id,
          stable_uid: stableUid,
          payment_id: null,
          result: 'created',
        });
      }
      continue;
    }

    // Execute mode - insert
    const { data: newPayment, error: insertError } = await supabase
      .from('payments_v2')
      .insert(paymentData)
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // Duplicate key - shouldn't happen with ANTI-JOIN but handle gracefully
        result.stats.skipped++;
        result.stats.to_create--;
        if (result.samples.length < 10) {
          result.samples.push({
            queue_id: queueItem.id,
            stable_uid: stableUid,
            payment_id: null,
            result: 'skipped',
            error: 'Already exists (race condition)',
          });
        }
      } else {
        result.stats.errors++;
        result.stats.to_create--;
        if (result.samples.length < 10) {
          result.samples.push({
            queue_id: queueItem.id,
            stable_uid: stableUid,
            payment_id: null,
            result: 'error',
            error: insertError.message,
          });
        }
      }
    } else {
      result.stats.created++;
      if (result.samples.length < 10) {
        result.samples.push({
          queue_id: queueItem.id,
          stable_uid: stableUid,
          payment_id: newPayment?.id || null,
          result: 'created',
        });
      }
    }
  }

  // Write single summary audit log at the end (not per-record)
  if (!dryRun && (result.stats.created > 0 || result.stats.updated > 0)) {
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-materialize-queue-payments',
      action: 'queue_materialize_to_payments_v2',
      meta: {
        dry_run: false,
        stats: {
          scanned: result.stats.scanned,
          to_create: result.stats.to_create,
          created: result.stats.created,
          updated: result.stats.updated,
          skipped: result.stats.skipped,
          errors: result.stats.errors,
        },
        next_cursor: result.next_cursor,
        sample_queue_ids: result.samples.slice(0, 5).map(s => s.queue_id),
      },
    });
  }

  // Warnings
  if (result.stats.errors > 0) {
    result.warnings.push(`${result.stats.errors} errors occurred during processing.`);
  }

  result.duration_ms = Date.now() - startTime;

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
