import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// PATCH-A1: Polling/Backfill Edge Function for bePaid transactions
// BUILD_ID for deployment verification
const BUILD_ID = 'bepaid-polling-backfill:2026-02-02T14:00:00Z';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Expected production shop_id - hard guard
const EXPECTED_SHOP_ID = '33524';

interface PollingResult {
  build_id: string;
  dry_run: boolean;
  since_hours: number;
  from_date?: string;
  to_date?: string;
  api_transactions_count: number;
  api_transactions_sum: number;
  db_existing_count: number;
  upserted_count: number;
  updated_count: number;
  skipped_count: number;
  missing_after: number;
  sample_uids: string[];
  errors: string[];
  duration_ms: number;
}

// Fetch transactions from bePaid API with pagination
async function fetchBepaidTransactions(
  shopId: string,
  secretKey: string,
  fromDate: Date,
  toDate: Date
): Promise<{ transactions: any[]; error?: string }> {
  const bepaidAuth = btoa(`${shopId}:${secretKey}`);
  const allTransactions: any[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;
  
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();
  
  console.log(`[${BUILD_ID}] Fetching bePaid transactions from ${fromIso} to ${toIso}`);
  
  while (hasMore) {
    try {
      const url = new URL('https://gateway.bepaid.by/transactions');
      url.searchParams.set('filter[created_at][from]', fromIso);
      url.searchParams.set('filter[created_at][to]', toIso);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${bepaidAuth}`,
          'Accept': 'application/json',
          'X-Api-Version': '3',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${BUILD_ID}] bePaid API error: ${response.status} - ${errorText}`);
        return { transactions: allTransactions, error: `API error: ${response.status}` };
      }
      
      const data = await response.json();
      const transactions = data.transactions || [];
      
      console.log(`[${BUILD_ID}] Page ${page}: ${transactions.length} transactions`);
      
      allTransactions.push(...transactions);
      
      // Check if there are more pages
      if (transactions.length < perPage) {
        hasMore = false;
      } else {
        page++;
        // Safety limit
        if (page > 100) {
          console.warn(`[${BUILD_ID}] Reached page limit (100)`);
          hasMore = false;
        }
      }
    } catch (err) {
      console.error(`[${BUILD_ID}] Fetch error on page ${page}:`, err);
      return { transactions: allTransactions, error: String(err) };
    }
  }
  
  console.log(`[${BUILD_ID}] Total fetched: ${allTransactions.length} transactions in ${page} pages`);
  return { transactions: allTransactions };
}

// Normalize bePaid status to our payment_status enum
function normalizeStatus(bepaidStatus: string): string {
  switch (bepaidStatus?.toLowerCase()) {
    case 'successful':
    case 'success':
      return 'succeeded';
    case 'failed':
    case 'declined':
    case 'expired':
    case 'error':
      return 'failed';
    case 'incomplete':
    case 'processing':
    case 'pending':
      return 'processing';
    case 'refunded':
    case 'voided':
      return 'refunded';
    default:
      return 'pending';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bepaidSecretKey = Deno.env.get('BEPAID_SECRET_KEY');
    
    if (!bepaidSecretKey) {
      return new Response(
        JSON.stringify({ error: 'BEPAID_SECRET_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // Default to dry run
    const sinceHours = body.since_hours || 48;
    const customFromDate = body.from_date ? new Date(body.from_date) : null;
    const customToDate = body.to_date ? new Date(body.to_date) : null;
    
    console.log(`[${BUILD_ID}] START: dry_run=${dryRun}, since_hours=${sinceHours}`);
    
    // Determine date range
    const now = new Date();
    const toDate = customToDate || now;
    const fromDate = customFromDate || new Date(now.getTime() - sinceHours * 60 * 60 * 1000);
    
    // Get shop_id from integration settings
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .limit(1)
      .maybeSingle();
    
    const shopId = (bepaidInstance?.config as any)?.shop_id || Deno.env.get('BEPAID_SHOP_ID');
    
    if (!shopId) {
      return new Response(
        JSON.stringify({ error: 'BEPAID_SHOP_ID not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // PATCH-0.1: Hard guard - verify shop_id matches expected
    if (String(shopId) !== EXPECTED_SHOP_ID) {
      console.error(`[${BUILD_ID}] SHOP_ID MISMATCH! Expected ${EXPECTED_SHOP_ID}, got ${shopId}`);
      return new Response(
        JSON.stringify({ error: `Shop ID mismatch: expected ${EXPECTED_SHOP_ID}` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Fetch transactions from bePaid API
    const { transactions, error: fetchError } = await fetchBepaidTransactions(
      shopId,
      bepaidSecretKey,
      fromDate,
      toDate
    );
    
    if (fetchError && transactions.length === 0) {
      return new Response(
        JSON.stringify({ error: fetchError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Get existing UIDs in DB for this period
    const { data: existingPayments } = await supabase
      .from('payments_v2')
      .select('provider_payment_id')
      .eq('provider', 'bepaid')
      .not('provider_payment_id', 'is', null)
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString());
    
    const existingUids = new Set((existingPayments || []).map(p => p.provider_payment_id));
    
    const result: PollingResult = {
      build_id: BUILD_ID,
      dry_run: dryRun,
      since_hours: sinceHours,
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
      api_transactions_count: transactions.length,
      api_transactions_sum: 0,
      db_existing_count: existingUids.size,
      upserted_count: 0,
      updated_count: 0,
      skipped_count: 0,
      missing_after: 0,
      sample_uids: [],
      errors: [],
      duration_ms: 0,
    };
    
    // Process transactions
    const missingUids: string[] = [];
    
    for (const tx of transactions) {
      const uid = tx.uid;
      const amount = (tx.amount || 0) / 100;
      result.api_transactions_sum += amount;
      
      if (!uid) {
        result.errors.push(`Transaction without UID: ${JSON.stringify(tx).substring(0, 100)}`);
        continue;
      }
      
      if (existingUids.has(uid)) {
        result.skipped_count++;
        continue;
      }
      
      // This transaction is missing in DB
      missingUids.push(uid);
      
      if (!dryRun) {
        // Upsert transaction
        try {
          const paymentData = {
            provider: 'bepaid',
            provider_payment_id: uid,
            amount: amount,
            currency: tx.currency || 'BYN',
            status: normalizeStatus(tx.status),
            transaction_type: tx.type || 'payment',
            paid_at: tx.paid_at || tx.created_at || null,
            created_at: tx.created_at || new Date().toISOString(),
            card_last4: tx.credit_card?.last_4 || null,
            card_brand: tx.credit_card?.brand || null,
            origin: 'api_backfill',
            provider_response: tx,
            meta: {
              backfill_source: 'bepaid-polling-backfill',
              backfilled_at: new Date().toISOString(),
              tracking_id: tx.tracking_id,
            },
          };
          
          // Check if exists by UID
          const { data: existing } = await supabase
            .from('payments_v2')
            .select('id')
            .eq('provider', 'bepaid')
            .eq('provider_payment_id', uid)
            .maybeSingle();
          
          if (existing) {
            // Update existing
            await supabase
              .from('payments_v2')
              .update({
                status: paymentData.status,
                paid_at: paymentData.paid_at,
                provider_response: paymentData.provider_response,
                meta: paymentData.meta,
              })
              .eq('id', existing.id);
            result.updated_count++;
          } else {
            // Insert new
            await supabase
              .from('payments_v2')
              .insert(paymentData);
            result.upserted_count++;
          }
        } catch (err) {
          result.errors.push(`Failed to upsert ${uid}: ${String(err)}`);
        }
      } else {
        result.upserted_count++; // Count would-be inserts in dry run
      }
    }
    
    result.missing_after = dryRun ? missingUids.length : 0;
    result.sample_uids = missingUids.slice(0, 20);
    result.duration_ms = Date.now() - startTime;
    
    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-polling-backfill',
      action: dryRun ? 'bepaid_polling_backfill_dry_run' : 'bepaid_polling_backfill_execute',
      meta: {
        ...result,
        sample_uids: result.sample_uids.slice(0, 10), // Limit in log
      },
    });
    
    console.log(`[${BUILD_ID}] COMPLETE: api=${result.api_transactions_count}, existing=${result.db_existing_count}, upserted=${result.upserted_count}, missing=${result.missing_after}`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (err) {
    console.error(`[${BUILD_ID}] Error:`, err);
    return new Response(
      JSON.stringify({ error: String(err), build_id: BUILD_ID }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
