import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  since_days?: number;
  limit?: number;
  dry_run?: boolean;
  only_failed?: boolean;
  only_rate_limit_ready?: boolean;
}

interface BackfillResponse {
  ok: boolean;
  dry_run: boolean;
  total_eligible: number;
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: string[];
  candidates?: Array<{
    order_id: string;
    order_number: string;
    customer_email: string;
    gc_status: string | null;
    gc_error: string | null;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: BackfillRequest = await req.json().catch(() => ({}));
    const {
      since_days = 90,
      limit = 50,
      dry_run = true,
      only_failed = false,
      only_rate_limit_ready = false,
    } = body;

    console.log(`[GC-BACKFILL] Starting: since_days=${since_days}, limit=${limit}, dry_run=${dry_run}, only_failed=${only_failed}, only_rate_limit_ready=${only_rate_limit_ready}`);

    const sinceDate = new Date(Date.now() - since_days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch eligible orders - simple query, let getcourse-grant-access handle offer resolution
    // We just need orders that are paid, have email, and not synced successfully
    let query = supabase
      .from('orders_v2')
      .select(`
        id,
        order_number,
        customer_email,
        meta,
        gc_next_retry_at
      `)
      .eq('status', 'paid')
      .gte('created_at', sinceDate)
      .not('customer_email', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit * 2); // Fetch more to filter

    const { data: orders, error: ordersError } = await query;

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    console.log(`[GC-BACKFILL] Fetched ${orders?.length || 0} paid orders with email`);

    // Filter eligible orders
    const eligibleOrders: any[] = [];
    
    for (const order of orders || []) {
      const meta = order.meta as any || {};
      const gcStatus = meta.gc_sync_status || null;
      
      // Skip already successful
      if (gcStatus === 'success') {
        continue;
      }

      // Apply filters
      if (only_failed && gcStatus !== 'failed') {
        continue;
      }

      if (only_rate_limit_ready) {
        // Use the real column for retry check
        const nextRetryAt = order.gc_next_retry_at;
        if (nextRetryAt && new Date(nextRetryAt) > new Date()) {
          console.log(`[GC-BACKFILL] Skipping ${order.order_number}: rate limit retry not ready until ${nextRetryAt}`);
          continue;
        }
      }

      eligibleOrders.push(order);

      if (eligibleOrders.length >= limit) break;
    }

    console.log(`[GC-BACKFILL] Found ${eligibleOrders.length} eligible orders for sync`);

    // Build response
    const response: BackfillResponse = {
      ok: true,
      dry_run,
      total_eligible: eligibleOrders.length,
      processed: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    // In dry run mode, return candidates list
    if (dry_run) {
      response.candidates = eligibleOrders.map(o => ({
        order_id: o.id,
        order_number: o.order_number,
        customer_email: o.customer_email,
        gc_status: (o.meta as any)?.gc_sync_status || null,
        gc_error: (o.meta as any)?.gc_sync_error || null,
      }));
      
      console.log(`[GC-BACKFILL] Dry run complete, ${response.total_eligible} candidates`);
      return new Response(JSON.stringify(response), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Process each order by calling getcourse-grant-access
    for (const order of eligibleOrders) {
      try {
        console.log(`[GC-BACKFILL] Processing ${order.order_number}...`);
        
        // Call getcourse-grant-access function - it handles all offer resolution internally
        const gcResponse = await supabase.functions.invoke('getcourse-grant-access', {
          body: { order_id: order.id, force: true },
        });

        response.processed++;

        if (gcResponse.error) {
          console.error(`[GC-BACKFILL] Function error for ${order.order_number}:`, gcResponse.error);
          response.errors.push(`${order.order_number}: ${gcResponse.error.message}`);
          response.failed++;
          continue;
        }

        const result = gcResponse.data;
        
        if (result?.status === 'success') {
          response.synced++;
          console.log(`[GC-BACKFILL] ✓ ${order.order_number} synced`);
        } else if (result?.status === 'skipped') {
          response.skipped++;
          console.log(`[GC-BACKFILL] ⏭ ${order.order_number} skipped: ${result.skipped_reason || result.error}`);
        } else {
          response.failed++;
          response.errors.push(`${order.order_number}: ${result?.error || 'Unknown error'}`);
          console.log(`[GC-BACKFILL] ✗ ${order.order_number} failed: ${result?.error}`);
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        console.error(`[GC-BACKFILL] Error processing ${order.order_number}:`, err);
        response.errors.push(`${order.order_number}: ${err.message}`);
        response.failed++;
        response.processed++;
      }
    }

    console.log(`[GC-BACKFILL] Complete:`, response);
    return new Response(JSON.stringify(response), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: any) {
    console.error('[GC-BACKFILL] Unexpected error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
