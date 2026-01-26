import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FileTransaction {
  uid: string;
  status: string;          // "Успешный", "Неуспешный", etc.
  transaction_type: string; // "Платеж", "Возврат средств", "Отмена"
  amount: number;
  currency?: string;
  paid_at?: string;
  description?: string;
  customer_email?: string;
  card_last4?: string;
  card_holder?: string;
  card_brand?: string;
}

interface ReconcileRequest {
  transactions: FileTransaction[];
  dry_run?: boolean;
  from_date?: string;  // Europe/Minsk timezone (UTC+3)
  to_date?: string;
  include_queue?: boolean;  // Include payment_reconcile_queue in comparison
}

interface ReconcileStats {
  file_count: number;
  db_count: number;
  matched: number;
  missing_in_db: number;
  extra_in_db: number;
  status_mismatches: number;
  amount_mismatches: number;
  type_mismatches: number;
  overrides_created: number;
  inserts_created: number;
  errors: number;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  stats: ReconcileStats;
  missing: Array<{ uid: string; status: string; amount: number; transaction_type: string }>;
  extra: Array<{ uid: string; amount: number; status: string }>;
  mismatches: Array<{ 
    uid: string; 
    file_status: string; 
    db_status: string; 
    file_amount?: number;
    db_amount?: number;
    file_type?: string;
    db_type?: string;
    mismatch_type: 'status' | 'amount' | 'type';
  }>;
  errors: string[];
  summary: {
    file: { successful: number; failed: number; refunded: number; cancelled: number; total_amount: number; total_fees: number };
    db: { successful: number; failed: number; refunded: number; cancelled: number; total_amount: number };
    net_revenue: number;
  };
}

// Convert Europe/Minsk dates to UTC for database queries
function minskToUtc(dateStr: string, isEndOfDay = false): string {
  // Parse YYYY-MM-DD and add 3 hours offset (Minsk is UTC+3)
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  
  if (isEndOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  
  // Subtract 3 hours to convert from Minsk to UTC
  date.setUTCHours(date.getUTCHours() - 3);
  
  return date.toISOString();
}

// Normalize file status to our standard
function normalizeFileStatus(status: string, txType: string): 'successful' | 'failed' | 'refunded' | 'cancelled' {
  const s = (status || '').toLowerCase();
  const t = (txType || '').toLowerCase();
  
  // Transaction type takes priority
  if (t.includes('возврат') || t.includes('refund')) return 'refunded';
  if (t.includes('отмен') || t.includes('cancel') || t.includes('void')) return 'cancelled';
  
  // Then status
  if (s.includes('успеш') || s === 'successful' || s === 'succeeded' || s === 'completed') return 'successful';
  if (s.includes('неуспеш') || s === 'failed' || s === 'error' || s === 'declined') return 'failed';
  if (s.includes('возврат') || s === 'refunded') return 'refunded';
  if (s.includes('отмен') || s === 'cancelled' || s === 'void') return 'cancelled';
  
  return 'failed'; // Default to failed for unknown
}

// Normalize DB status to our standard
function normalizeDbStatus(status: string, txType: string): 'successful' | 'failed' | 'refunded' | 'cancelled' {
  const s = (status || '').toLowerCase();
  const t = (txType || '').toLowerCase();
  
  // Transaction type takes priority for refunds/cancels
  if (t.includes('refund') || t.includes('возврат')) return 'refunded';
  if (t.includes('void') || t.includes('cancel') || t.includes('отмен')) return 'cancelled';
  
  // Then status
  if (s === 'succeeded' || s === 'successful' || s === 'completed' || s === 'success') return 'successful';
  if (s === 'failed' || s === 'error' || s === 'declined') return 'failed';
  if (s === 'refunded') return 'refunded';
  if (s === 'canceled' || s === 'cancelled' || s === 'void') return 'cancelled';
  
  return 'failed';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: ReconcileRequest = await req.json();
    const { transactions, dry_run = true, from_date, to_date, include_queue = false } = body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No transactions provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Reconciling ${transactions.length} transactions, dry_run=${dry_run}`);

    // Build date range filter for DB query (convert Minsk to UTC)
    let dateFrom: string | undefined;
    let dateTo: string | undefined;
    if (from_date && to_date) {
      dateFrom = minskToUtc(from_date, false);
      dateTo = minskToUtc(to_date, true);
      console.log(`Date range: ${from_date} to ${to_date} (Minsk) -> ${dateFrom} to ${dateTo} (UTC)`);
    }

    // Fetch all DB records for the period
    let dbQuery = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, status, transaction_type, amount, origin')
      .eq('provider', 'bepaid');
    
    if (dateFrom && dateTo) {
      dbQuery = dbQuery.gte('paid_at', dateFrom).lte('paid_at', dateTo);
    }

    const { data: dbRecords, error: dbError } = await dbQuery;
    if (dbError) throw dbError;

    // Optionally fetch queue records for unified view
    let queueRecords: any[] = [];
    if (include_queue) {
      let queueQuery = supabase
        .from('payment_reconcile_queue')
        .select('id, bepaid_uid, status, amount, paid_at')
        .not('bepaid_uid', 'is', null);
      
      if (dateFrom && dateTo) {
        queueQuery = queueQuery.gte('paid_at', dateFrom).lte('paid_at', dateTo);
      }
      
      const { data: qData } = await queueQuery;
      queueRecords = qData || [];
    }

    // Also fetch status overrides
    const { data: overrides } = await supabase
      .from('payment_status_overrides')
      .select('uid, status_override')
      .eq('provider', 'bepaid');

    const overridesMap = new Map((overrides || []).map(o => [o.uid, o.status_override]));
    const dbMap = new Map((dbRecords || []).map(r => [r.provider_payment_id, r]));
    
    // Build queue map (only UIDs not already in payments_v2)
    const queueMap = new Map<string, any>();
    for (const q of queueRecords) {
      if (q.bepaid_uid && !dbMap.has(q.bepaid_uid)) {
        queueMap.set(q.bepaid_uid, q);
      }
    }

    // Build file index
    const fileMap = new Map(transactions.map(t => [t.uid, t]));

    // Calculate summaries
    const fileSummary = { successful: 0, failed: 0, refunded: 0, cancelled: 0, total_amount: 0, total_fees: 0 };
    const dbSummary = { successful: 0, failed: 0, refunded: 0, cancelled: 0, total_amount: 0 };

    // File summary
    for (const tx of transactions) {
      const normStatus = normalizeFileStatus(tx.status, tx.transaction_type);
      const amount = Math.abs(tx.amount || 0);
      
      if (normStatus === 'successful') {
        fileSummary.successful++;
        fileSummary.total_amount += amount;
      } else if (normStatus === 'failed') {
        fileSummary.failed++;
      } else if (normStatus === 'refunded') {
        fileSummary.refunded++;
      } else if (normStatus === 'cancelled') {
        fileSummary.cancelled++;
      }
    }

    // DB summary (applying overrides)
    for (const rec of (dbRecords || [])) {
      const override = overridesMap.get(rec.provider_payment_id);
      const effectiveStatus = override || rec.status;
      const normStatus = normalizeDbStatus(effectiveStatus, rec.transaction_type);
      const amount = Math.abs(rec.amount || 0);
      
      if (normStatus === 'successful') {
        dbSummary.successful++;
        dbSummary.total_amount += amount;
      } else if (normStatus === 'failed') {
        dbSummary.failed++;
      } else if (normStatus === 'refunded') {
        dbSummary.refunded++;
      } else if (normStatus === 'cancelled') {
        dbSummary.cancelled++;
      }
    }

    // Find discrepancies
    const missing: Array<{ uid: string; status: string; amount: number; transaction_type: string }> = [];
    const mismatches: Array<{ 
      uid: string; 
      file_status: string; 
      db_status: string; 
      file_amount?: number;
      db_amount?: number;
      file_type?: string;
      db_type?: string;
      mismatch_type: 'status' | 'amount' | 'type';
    }> = [];
    const extra: Array<{ uid: string; amount: number; status: string }> = [];
    const errors: string[] = [];

    let overridesCreated = 0;
    let insertsCreated = 0;
    let matched = 0;
    let amountMismatches = 0;
    let typeMismatches = 0;

    for (const tx of transactions) {
      const dbRec = dbMap.get(tx.uid);
      const queueRec = queueMap.get(tx.uid);
      const fileNormStatus = normalizeFileStatus(tx.status, tx.transaction_type);

      if (!dbRec && !queueRec) {
        // Missing in both DB and queue - needs insert
        missing.push({ uid: tx.uid, status: tx.status, amount: tx.amount, transaction_type: tx.transaction_type });
      } else if (!dbRec && queueRec) {
        // In queue but not materialized - check for status mismatch
        const queueNormStatus = normalizeDbStatus(queueRec.status, '');
        if (fileNormStatus !== queueNormStatus) {
          mismatches.push({
            uid: tx.uid,
            file_status: fileNormStatus,
            db_status: queueNormStatus,
            mismatch_type: 'status',
          });
        } else if (Math.abs(tx.amount) !== Math.abs(queueRec.amount || 0)) {
          mismatches.push({
            uid: tx.uid,
            file_status: fileNormStatus,
            db_status: queueNormStatus,
            file_amount: tx.amount,
            db_amount: queueRec.amount,
            mismatch_type: 'amount',
          });
          amountMismatches++;
        } else {
          matched++;
        }
      } else if (!dbRec) {
        // This shouldn't happen given the logic above, but safety fallback
        missing.push({ uid: tx.uid, status: tx.status, amount: tx.amount, transaction_type: tx.transaction_type });

        if (!dry_run) {
          // Insert directly into payments_v2
          const insertStatus = fileNormStatus === 'successful' ? 'succeeded' : 
                              fileNormStatus === 'refunded' ? 'refunded' :
                              fileNormStatus === 'cancelled' ? 'canceled' : 'failed';
          
          const insertAmount = (fileNormStatus === 'refunded' || fileNormStatus === 'cancelled') 
            ? -Math.abs(tx.amount) : Math.abs(tx.amount);

          const { error: insertError } = await supabase
            .from('payments_v2')
            .insert({
              provider: 'bepaid',
              provider_payment_id: tx.uid,
              status: insertStatus,
              transaction_type: tx.transaction_type || 'payment',
              amount: insertAmount,
              currency: tx.currency || 'BYN',
              origin: 'bepaid',
              paid_at: tx.paid_at,
              product_name_raw: tx.description,
              card_last4: tx.card_last4,
              card_brand: tx.card_brand,
              import_ref: 'file_reconcile',
            });

          if (insertError) {
            if (!insertError.message.includes('duplicate')) {
              errors.push(`Insert ${tx.uid}: ${insertError.message}`);
            }
          } else {
            insertsCreated++;
          }
        }
      } else {
        // Exists in DB - check status match
        const override = overridesMap.get(tx.uid);
        const dbEffectiveStatus = override || dbRec.status;
        const dbNormStatus = normalizeDbStatus(dbEffectiveStatus, dbRec.transaction_type);

        // Check for amount mismatch
        if (Math.abs(tx.amount) !== Math.abs(dbRec.amount)) {
          mismatches.push({ 
            uid: tx.uid, 
            file_status: fileNormStatus, 
            db_status: dbNormStatus,
            file_amount: tx.amount,
            db_amount: dbRec.amount,
            mismatch_type: 'amount'
          });
          amountMismatches++;
        } else if (fileNormStatus !== dbNormStatus) {
          // Status mismatch
          mismatches.push({ 
            uid: tx.uid, 
            file_status: fileNormStatus, 
            db_status: dbNormStatus,
            mismatch_type: 'status'
          });

          if (!dry_run) {
            // Create/update status override
            const overrideStatus = fileNormStatus === 'successful' ? 'succeeded' :
                                  fileNormStatus === 'refunded' ? 'refunded' :
                                  fileNormStatus === 'cancelled' ? 'canceled' : 'failed';

            const { error: overrideError } = await supabase
              .from('payment_status_overrides')
              .upsert({
                provider: 'bepaid',
                uid: tx.uid,
                status_override: overrideStatus,
                reason: 'Excel reconciliation',
                source: 'file_reconcile',
                created_at: new Date().toISOString(),
              }, {
                onConflict: 'provider,uid'
              });

            if (overrideError) {
              errors.push(`Override ${tx.uid}: ${overrideError.message}`);
            } else {
              overridesCreated++;
            }
          }
        }
      }
    }

    // Check for DB records not in file (possible orphans)
    const fileUids = new Set(transactions.map(t => t.uid));
    const orphansInDb = (dbRecords || []).filter(r => !fileUids.has(r.provider_payment_id));
    for (const orphan of orphansInDb) {
      extra.push({ uid: orphan.provider_payment_id, amount: orphan.amount, status: orphan.status });
    }
    if (orphansInDb.length > 0) {
      console.log(`Warning: ${orphansInDb.length} records in DB not found in file`);
    }

    // Calculate net revenue
    const netRevenue = fileSummary.total_amount - fileSummary.total_fees;

    const stats: ReconcileStats = {
      file_count: transactions.length,
      db_count: dbRecords?.length || 0,
      matched,
      missing_in_db: missing.length,
      extra_in_db: extra.length,
      status_mismatches: mismatches.filter(m => m.mismatch_type === 'status').length,
      amount_mismatches: amountMismatches,
      type_mismatches: typeMismatches,
      overrides_created: overridesCreated,
      inserts_created: insertsCreated,
      errors: errors.length,
    };

    const result: ReconcileResult = {
      success: true,
      dry_run,
      stats,
      missing: missing.slice(0, 50),
      extra: extra.slice(0, 50),
      mismatches: mismatches.slice(0, 50),
      errors: errors.slice(0, 20),
      summary: {
        file: fileSummary,
        db: dbSummary,
        net_revenue: netRevenue,
      },
    };

    // Log audit entry
    if (!dry_run) {
      await supabase.from('audit_logs').insert({
        action: 'bepaid_file_reconcile',
        actor_type: 'system',
        meta: {
          file_count: stats.file_count,
          inserts: stats.inserts_created,
          overrides: stats.overrides_created,
          errors: stats.errors,
          from_date,
          to_date,
        },
      });
    }

    console.log(`Reconciliation complete: ${JSON.stringify(stats)}`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Reconcile error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
