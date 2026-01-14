import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PurgeRequest {
  date_from?: string;
  date_to?: string;
  source_filter?: string; // 'csv', 'file_import', 'all'
  dry_run?: boolean;
  limit?: number;
}

interface PurgeResult {
  id: string;
  bepaid_uid: string | null;
  amount: number;
  currency: string;
  paid_at: string | null;
  source: string;
  has_conflict: boolean;
  conflict_reason?: string;
}

interface PurgeReport {
  total_found: number;
  eligible_for_deletion: number;
  with_conflicts: number;
  deleted: number;
  examples: PurgeResult[];
  conflicts: PurgeResult[];
  total_amount: number;
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

    const body: PurgeRequest = await req.json();
    const { 
      date_from,
      date_to,
      source_filter = 'all', // Default to 'all' to include both csv and file_import
      dry_run = true,
      limit = 500,
    } = body;

    console.log(`[admin-purge-imported] Starting purge: source=${source_filter}, dry_run=${dry_run}, limit=${limit}, date_from=${date_from}, date_to=${date_to}`);

    // Hard limit for safety
    const hardLimit = Math.min(limit, 500);

    // Determine which sources to include
    const importSources = source_filter === 'all' 
      ? ['csv', 'file_import'] 
      : [source_filter];

    // Build the query
    let query = supabaseAdmin
      .from('payment_reconcile_queue')
      .select('id, bepaid_uid, amount, currency, paid_at, source, is_external, has_conflict, created_at')
      .in('source', importSources)
      .order('created_at', { ascending: false })
      .limit(hardLimit);

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
            eligible_for_deletion: 0,
            with_conflicts: 0,
            deleted: 0,
            examples: [],
            conflicts: [],
            total_amount: 0,
          }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const report: PurgeReport = {
      total_found: importedItems.length,
      eligible_for_deletion: 0,
      with_conflicts: 0,
      deleted: 0,
      examples: [],
      conflicts: [],
      total_amount: 0,
    };

    const toDelete: string[] = [];

    for (const item of importedItems) {
      const hasApiConflict = item.bepaid_uid && existingUids.has(item.bepaid_uid);
      
      const result: PurgeResult = {
        id: item.id,
        bepaid_uid: item.bepaid_uid,
        amount: item.amount,
        currency: item.currency,
        paid_at: item.paid_at,
        source: item.source,
        has_conflict: hasApiConflict || item.has_conflict,
        conflict_reason: hasApiConflict ? 'EXISTS_IN_API' : undefined,
      };

      if (hasApiConflict || item.has_conflict) {
        report.with_conflicts++;
        if (report.conflicts.length < 10) {
          report.conflicts.push(result);
        }
      } else {
        report.eligible_for_deletion++;
        report.total_amount += item.amount || 0;
        toDelete.push(item.id);
        if (report.examples.length < 10) {
          report.examples.push(result);
        }
      }
    }

    // Execute deletion if not dry run
    if (!dry_run && toDelete.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('payment_reconcile_queue')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error('[admin-purge-imported] Delete error:', deleteError);
        return new Response(
          JSON.stringify({ success: false, message: deleteError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      report.deleted = toDelete.length;
    }

    // Write audit log
    await supabaseAdmin.from('audit_logs').insert({
      action: 'purge_imported_transactions',
      actor_user_id: user.id,
      meta: {
        dry_run,
        source_filter,
        date_from,
        date_to,
        limit: hardLimit,
        total_found: report.total_found,
        eligible_for_deletion: report.eligible_for_deletion,
        with_conflicts: report.with_conflicts,
        deleted: report.deleted,
        total_amount: report.total_amount,
      },
    });

    console.log(`[admin-purge-imported] Complete: found=${report.total_found}, eligible=${report.eligible_for_deletion}, conflicts=${report.with_conflicts}, deleted=${report.deleted}`);

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