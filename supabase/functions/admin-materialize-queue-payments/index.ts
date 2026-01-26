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

// Batch check for existing payments - avoid URL length issues
async function getExistingPaymentIds(
  supabase: any, 
  stableUids: string[]
): Promise<Set<string>> {
  const existingSet = new Set<string>();
  
  // Process in batches of 50 to avoid URL length limits
  const BATCH_SIZE = 50;
  for (let i = 0; i < stableUids.length; i += BATCH_SIZE) {
    const batch = stableUids.slice(i, i + BATCH_SIZE);
    
    const { data, error } = await supabase
      .from('payments_v2')
      .select('provider_payment_id')
      .in('provider_payment_id', batch);
    
    if (error) {
      console.error('Batch check error:', error.message);
      continue;
    }
    
    for (const row of (data || [])) {
      if (row.provider_payment_id) {
        existingSet.add(row.provider_payment_id);
      }
    }
  }
  
  return existingSet;
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

    // 1. Fetch completed queue items (fetch more to account for filtering)
    let query = supabase
      .from('payment_reconcile_queue')
      .select('*')
      .eq('status', 'completed')
      .order('paid_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit * 2); // Fetch extra to ensure we get enough after filtering

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
      // Cursor-based pagination
      query = query.or(`paid_at.gt.${cursorPaidAt},and(paid_at.eq.${cursorPaidAt},id.gt.${cursorId})`);
    }

    const { data: allQueueItems, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    }

    if (!allQueueItems || allQueueItems.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Build stable_uids for batch existence check
    // PATCH-1: ONLY use bepaid_uid as stable identifier. Never use tracking_id as UID!
    const itemsWithUids: Array<{ item: typeof allQueueItems[0]; stableUid: string }> = [];
    const itemsNeedingUid: typeof allQueueItems = [];
    
    for (const item of allQueueItems) {
      if (item.bepaid_uid) {
        itemsWithUids.push({ item, stableUid: item.bepaid_uid });
      } else {
        // No bepaid_uid - mark as needs_uid, do NOT materialize
        itemsNeedingUid.push(item);
      }
    }
    
    // Update queue items without bepaid_uid to needs_uid status
    if (itemsNeedingUid.length > 0 && !dryRun) {
      const needsUidIds = itemsNeedingUid.map(i => i.id);
      await supabase
        .from('payment_reconcile_queue')
        .update({ status: 'needs_uid' })
        .in('id', needsUidIds);
      
      // Log each as audit
      for (const item of itemsNeedingUid.slice(0, 10)) {
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'admin-materialize-queue-payments',
          action: 'payment.queue_item_missing_bepaid_uid',
          meta: {
            queue_id: item.id,
            tracking_id: item.tracking_id,
            amount: item.amount,
            paid_at: item.paid_at,
          },
        });
      }
      
      result.warnings.push(`${itemsNeedingUid.length} queue items skipped: no bepaid_uid (marked as needs_uid)`);
    } else if (itemsNeedingUid.length > 0 && dryRun) {
      result.warnings.push(`${itemsNeedingUid.length} queue items would be marked needs_uid (no bepaid_uid)`);
    }

    const stableUids = itemsWithUids.map(x => x.stableUid);

    // 3. Batch check which already exist in payments_v2
    const existingSet = await getExistingPaymentIds(supabase, stableUids);

    // 4. Filter to only unmaterialized items, limit to requested count
    const unmaterializedItems = itemsWithUids
      .filter(x => !existingSet.has(x.stableUid))
      .slice(0, limit);

    result.stats.scanned = unmaterializedItems.length;
    result.stats.to_create = unmaterializedItems.length;

    if (unmaterializedItems.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Set next cursor from last item
    const lastItem = unmaterializedItems[unmaterializedItems.length - 1].item;
    result.next_cursor = {
      paid_at: lastItem.paid_at,
      id: lastItem.id,
    };

    // 5. Process each unmaterialized item
    for (const { item: queueItem, stableUid } of unmaterializedItems) {
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
        // Dry-run: just count
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

      // Execute: insert new payment
      const { data: newPayment, error: insertError } = await supabase
        .from('payments_v2')
        .insert(paymentData)
        .select('id')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          // Duplicate key - race condition, skip
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

    // 6. Write summary audit log (only on execute with actual changes)
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
