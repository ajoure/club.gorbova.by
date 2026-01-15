import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * SOFT-CANCEL for file_import queue items
 * 
 * CRITICAL: This function does NOT delete records.
 * It updates status to 'cancelled' (or 'error' with cancel metadata if enum doesn't allow 'cancelled')
 * 
 * Safety features:
 * - STOP safeguards: batch limits, unsafe check
 * - Audit logs with system actor
 * - Conflict detection (items in payments_v2)
 * - Idempotent: safe to run multiple times
 */

interface CancelRequest {
  date_from?: string;
  date_to?: string;
  source_filter?: string; // 'csv', 'file_import', 'all'
  status_filter?: string[]; // ['pending', 'error', 'processing']
  dry_run?: boolean;
  limit?: number;
  batch_size?: number;
  unsafe_allow_large?: boolean; // Must be true if cancelling > 1000 items
}

interface CancelResult {
  id: string;
  bepaid_uid: string | null;
  amount: number;
  currency: string;
  paid_at: string | null;
  source: string;
  status: string;
  has_conflict: boolean;
  conflict_reason?: string;
}

interface CancelReport {
  total_found: number;
  eligible_for_cancel: number;
  with_conflicts: number;
  cancelled: number;
  examples: CancelResult[];
  conflicts: CancelResult[];
  total_amount: number;
  stop_reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ success: false, message: "Missing authorization" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    // Verify user is admin
    const { data: { user } } = await supabaseAnon.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: isAdmin } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin'
    });

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, message: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: CancelRequest = await req.json();
    const { 
      date_from,
      date_to,
      source_filter = 'file_import', // Default to file_import only
      status_filter = ['pending', 'error', 'processing'],
      dry_run = true,
      limit = 5000,
      batch_size = 500,
      unsafe_allow_large = false,
    } = body;

    console.log(`[admin-purge-imported] Starting SOFT-CANCEL: source=${source_filter}, statuses=${status_filter?.join(',')}, dry_run=${dry_run}, limit=${limit}, date_from=${date_from}, date_to=${date_to}`);

    // Hard limit for safety
    const hardLimit = Math.min(limit, 5000);
    const batchLimit = Math.min(batch_size, 1000);

    // Determine which sources to include
    const importSources = source_filter === 'all' 
      ? ['csv', 'file_import'] 
      : [source_filter];

    // Build the query (note: table has no 'meta' column)
    let query = supabaseAdmin
      .from('payment_reconcile_queue')
      .select('id, bepaid_uid, amount, currency, paid_at, source, is_external, has_conflict, created_at, status, last_error')
      .in('source', importSources)
      .order('created_at', { ascending: false })
      .limit(hardLimit);

    // Apply status filter (for targeting stuck items)
    if (status_filter && status_filter.length > 0) {
      query = query.in('status', status_filter);
    }

    // Apply date filters if provided
    if (date_from) {
      query = query.gte('created_at', `${date_from}T00:00:00Z`);
    }
    if (date_to) {
      query = query.lte('created_at', `${date_to}T23:59:59Z`);
    }

    const { data: importedItems, error: queryError } = await query;

    if (queryError) {
      console.error('[admin-purge-imported] Query error:', queryError);
      return new Response(
        JSON.stringify({ success: false, message: queryError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!importedItems || importedItems.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          dry_run,
          report: {
            total_found: 0,
            eligible_for_cancel: 0,
            with_conflicts: 0,
            cancelled: 0,
            examples: [],
            conflicts: [],
            total_amount: 0,
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STOP SAFEGUARD: Check if trying to cancel too many without unsafe flag
    if (importedItems.length > 1000 && !unsafe_allow_large && !dry_run) {
      console.log(`[admin-purge-imported] STOP: Attempting to cancel ${importedItems.length} items without unsafe_allow_large flag`);
      
      const report: CancelReport = {
        total_found: importedItems.length,
        eligible_for_cancel: 0,
        with_conflicts: 0,
        cancelled: 0,
        examples: [],
        conflicts: [],
        total_amount: 0,
        stop_reason: `STOP_SAFEGUARD: Attempting to cancel ${importedItems.length} items (>1000). Set unsafe_allow_large=true to proceed.`,
      };

      // Log the blocked attempt
      await supabaseAdmin.from('audit_logs').insert({
        action: 'bepaid_cancel_blocked',
        actor_user_id: user.id,
        actor_type: 'system',
        actor_label: 'bepaid_cleanup_safeguard',
        meta: {
          reason: 'STOP_SAFEGUARD',
          items_count: importedItems.length,
          source_filter,
          status_filter,
          date_from,
          date_to,
          timestamp: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ 
          success: false, 
          dry_run,
          stop_reason: report.stop_reason,
          report 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for conflicts - items that exist in API (payments_v2)
    const uids = importedItems.filter(i => i.bepaid_uid).map(i => i.bepaid_uid);
    let existingUids = new Set<string>();
    
    if (uids.length > 0) {
      const { data: existingInApi } = await supabaseAdmin
        .from('payments_v2')
        .select('provider_payment_id')
        .in('provider_payment_id', uids);

      existingUids = new Set((existingInApi || []).map(p => p.provider_payment_id));
    }

    const report: CancelReport = {
      total_found: importedItems.length,
      eligible_for_cancel: 0,
      with_conflicts: 0,
      cancelled: 0,
      examples: [],
      conflicts: [],
      total_amount: 0,
    };

    const toCancel: string[] = [];

    for (const item of importedItems) {
      const hasApiConflict = item.bepaid_uid && existingUids.has(item.bepaid_uid);
      
      const result: CancelResult = {
        id: item.id,
        bepaid_uid: item.bepaid_uid,
        amount: item.amount,
        currency: item.currency,
        paid_at: item.paid_at,
        source: item.source,
        status: item.status,
        has_conflict: hasApiConflict || item.has_conflict,
        conflict_reason: hasApiConflict ? 'EXISTS_IN_API' : undefined,
      };

      if (hasApiConflict || item.has_conflict) {
        report.with_conflicts++;
        if (report.conflicts.length < 10) {
          report.conflicts.push(result);
        }
      } else {
        report.eligible_for_cancel++;
        report.total_amount += item.amount || 0;
        toCancel.push(item.id);
        if (report.examples.length < 10) {
          report.examples.push(result);
        }
      }
    }

    // Execute SOFT-CANCEL if not dry run - use batching for large sets
    // CRITICAL: We UPDATE status, NOT DELETE!
    if (!dry_run && toCancel.length > 0) {
      let cancelledCount = 0;
      const batches: string[][] = [];
      const cancelTimestamp = new Date().toISOString();
      
      // Split into batches
      for (let i = 0; i < toCancel.length; i += batchLimit) {
        batches.push(toCancel.slice(i, i + batchLimit));
      }
      
      console.log(`[admin-purge-imported] SOFT-CANCELLING ${toCancel.length} items in ${batches.length} batches`);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`[admin-purge-imported] Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);
        
        // SOFT-CANCEL: Update status to 'cancelled' with info in last_error
        // If 'cancelled' is not a valid enum value, use 'error' with cancel info
        const cancelInfo = `CANCELLED_BY_ADMIN|${cancelTimestamp}|${user.id}|file_import_cleanup`;
        const { error: updateError } = await supabaseAdmin
          .from('payment_reconcile_queue')
          .update({ 
            status: 'cancelled', // If enum doesn't have 'cancelled', will fallback
            last_error: cancelInfo,
          })
          .in('id', batch);

        if (updateError) {
          // Try fallback to 'error' status if 'cancelled' is not valid enum
          console.log(`[admin-purge-imported] 'cancelled' status failed, trying 'error' fallback:`, updateError.message);
          const fallbackInfo = `SOFT_CANCELLED|${cancelTimestamp}|${user.id}|file_import_cleanup`;
          
          const { error: fallbackError } = await supabaseAdmin
            .from('payment_reconcile_queue')
            .update({ 
              status: 'error',
              last_error: fallbackInfo,
            })
            .in('id', batch);

          if (fallbackError) {
            console.error(`[admin-purge-imported] Fallback error in batch ${i + 1}:`, fallbackError);
            report.cancelled = cancelledCount;
            
            // Write partial audit log
            await supabaseAdmin.from('audit_logs').insert({
              action: 'bepaid_cancel_partial',
              actor_user_id: null, // System actor
              actor_type: 'system',
              actor_label: 'bepaid_cleanup',
              meta: {
                dry_run: false,
                source_filter,
                status_filter,
                date_from,
                date_to,
                batch_failed: i + 1,
                total_batches: batches.length,
                cancelled_so_far: cancelledCount,
                error: fallbackError.message,
                initiated_by: user.id,
              },
            });
            
            return new Response(
              JSON.stringify({ 
                success: false, 
                message: `Batch ${i + 1} failed: ${fallbackError.message}`,
                partial_cancelled: cancelledCount,
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        
        cancelledCount += batch.length;
      }

      report.cancelled = cancelledCount;
      console.log(`[admin-purge-imported] Successfully soft-cancelled ${cancelledCount} items`);
    }

    // Write audit log with system actor
    await supabaseAdmin.from('audit_logs').insert({
      action: dry_run ? 'bepaid_cancel_preview' : 'bepaid_cancel_executed',
      actor_user_id: null, // System actor for the operation itself
      actor_type: 'system',
      actor_label: 'bepaid_cleanup',
      meta: {
        dry_run,
        source_filter,
        status_filter,
        date_from,
        date_to,
        limit: hardLimit,
        batch_size: batchLimit,
        unsafe_allow_large,
        total_found: report.total_found,
        eligible_for_cancel: report.eligible_for_cancel,
        with_conflicts: report.with_conflicts,
        cancelled: report.cancelled,
        total_amount: report.total_amount,
        initiated_by: user.id,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[admin-purge-imported] Complete: found=${report.total_found}, eligible=${report.eligible_for_cancel}, conflicts=${report.with_conflicts}, cancelled=${report.cancelled}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        dry_run,
        report 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[admin-purge-imported] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
