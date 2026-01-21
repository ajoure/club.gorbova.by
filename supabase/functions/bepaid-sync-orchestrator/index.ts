import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ TYPES ============
interface SyncRequest {
  mode: 'bepaid_api' | 'import_csv';
  from_date: string;
  to_date: string;
  dry_run?: boolean;
  run_id?: string; // for continuation
  batch_size?: number;
}

interface NormalizedTx {
  uid: string;
  amount: number;
  raw_amount: number;
  currency: string;
  transaction_type: 'payment' | 'refund';
  status: string;
  paid_at: string;
  card_last4: string | null;
  card_brand: string | null;
  card_holder: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  product_title: string | null;
  product_description: string | null;
  provider_response: any;
}

interface SyncStats {
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  stopped_reason: string | null;
  error_samples: Array<{ uid: string; error: string }>;
  amount_sum_db: number;
  amount_sum_api: number;
  diff_count: number;
  diff_amount: number;
}

// ============ CONSTANTS ============
const MAX_CONSECUTIVE_ERRORS = 50;
const MAX_DELTA_PER_TX_BYN = 1000;
const BATCH_SIZE = 100;
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

// ============ HELPERS ============

function normalizeStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  const s = String(status).toLowerCase();
  if (s === 'successful' || s === 'success' || s === 'captured') return 'succeeded';
  if (s === 'failed' || s === 'error' || s === 'declined') return 'failed';
  if (s === 'pending' || s === 'incomplete') return 'pending';
  if (s === 'refunded') return 'refunded';
  if (s === 'voided' || s === 'cancelled') return 'cancelled';
  return s;
}

function normalizeCardBrand(brand: string | undefined): string | null {
  if (!brand) return null;
  const b = String(brand).toLowerCase();
  if (b.includes('visa')) return 'visa';
  if (b.includes('master')) return 'mastercard';
  if (b.includes('belcard') || b.includes('белкарт')) return 'belcard';
  if (b.includes('mir') || b.includes('мир')) return 'mir';
  return brand;
}

function normalizeLast4(last4: any): string | null {
  if (!last4) return null;
  const s = String(last4).replace(/\D/g, '');
  return s.length >= 4 ? s.slice(-4) : null;
}

function determineTransactionType(tx: any): 'payment' | 'refund' {
  const type = String(tx.type || tx.transaction_type || '').toLowerCase();
  if (type.includes('refund')) return 'refund';
  
  const status = String(tx.status || '').toLowerCase();
  if (status === 'refunded') return 'refund';
  
  // Check for negative amount hint
  if (typeof tx.amount === 'number' && tx.amount < 0) return 'refund';
  
  return 'payment';
}

function normalizeTx(raw: any): { tx: NormalizedTx | null; error?: string } {
  try {
    // 1) UID required
    const uid = raw.uid || raw.id;
    if (!uid) {
      return { tx: null, error: 'Missing UID' };
    }

    // 2) Amount normalization (minor → major units)
    const rawAmount = raw.amount;
    if (typeof rawAmount !== 'number') {
      return { tx: null, error: `Invalid amount type: ${typeof rawAmount}` };
    }
    const normalizedAmount = rawAmount / 100; // bePaid uses kopecks

    // 3) Currency REQUIRED — NO DEFAULT
    const currency = raw.currency || raw.currency_code || raw.currencyCode;
    if (!currency) {
      return { tx: null, error: 'Currency field missing - STOP required' };
    }
    const normalizedCurrency = String(currency).toUpperCase();
    if (normalizedCurrency !== 'BYN') {
      return { tx: null, error: `Currency mismatch: expected BYN, got ${normalizedCurrency} - STOP required` };
    }

    // 4) Transaction type
    const txType = determineTransactionType(raw);
    const signedAmount = txType === 'refund' ? -Math.abs(normalizedAmount) : Math.abs(normalizedAmount);

    // 5) Extract card info
    const cc = raw.credit_card || raw.card || {};
    
    // 6) Extract customer info
    const customer = raw.customer || {};
    const additional = raw.additional_data || {};

    // 7) Extract product info
    const product = raw.product || additional.product || {};

    return {
      tx: {
        uid: String(uid),
        amount: signedAmount,
        raw_amount: rawAmount,
        currency: 'BYN',
        transaction_type: txType,
        status: normalizeStatus(raw.status),
        paid_at: raw.paid_at || raw.created_at || raw.finished_at || new Date().toISOString(),
        card_last4: normalizeLast4(cc.last_4 || cc.last4 || cc.number?.slice(-4)),
        card_brand: normalizeCardBrand(cc.brand || cc.type),
        card_holder: cc.holder || cc.cardholder || null,
        customer_email: customer.email || additional.receipt?.email || raw.email || null,
        customer_phone: customer.phone || additional.receipt?.phone || raw.phone || null,
        product_title: product.name || additional.description || raw.description || null,
        product_description: product.description || null,
        provider_response: raw,
      }
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { tx: null, error: `Parse error: ${message}` };
  }
}

async function fetchWithRetry(
  url: string,
  auth: string,
  maxRetries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 429) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      console.log(`[Sync] Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (response.status >= 500) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.log(`[Sync] Server error ${response.status}, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    return response;
  }
  
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

async function fetchTransactionByUid(
  uid: string,
  shopId: string,
  auth: string
): Promise<{ tx: any | null; error?: string }> {
  const endpoints = [
    `https://api.bepaid.by/beyag/payments/${uid}`,
    `https://api.bepaid.by/beyag/transactions/${uid}`,
    `https://gateway.bepaid.by/v2/transactions/${uid}`,
    `https://api.bepaid.by/v1/shops/${shopId}/transactions/${uid}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithRetry(endpoint, auth);
      
      if (response.ok) {
        const data = await response.json();
        
        // Extract transaction from known shapes
        let tx = data;
        if (data.transaction) tx = data.transaction;
        else if (data.data?.transaction) tx = data.data.transaction;
        else if (data.data && data.data.uid) tx = data.data;
        
        if (tx && (tx.uid || tx.id)) {
          return { tx };
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[Sync] Endpoint ${endpoint} failed: ${message}`);
    }
  }

  return { tx: null, error: 'Transaction not found in any endpoint' };
}

// ============ MAIN HANDLER ============
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // === AUTH CHECK ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === PARSE REQUEST ===
    const body: SyncRequest = await req.json();
    const {
      mode = 'bepaid_api',
      from_date,
      to_date,
      dry_run = false,
      batch_size = BATCH_SIZE,
    } = body;

    if (!from_date || !to_date) {
      return new Response(JSON.stringify({ error: "from_date and to_date required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Sync] Starting ${mode} sync for ${from_date} to ${to_date}, dry_run=${dry_run}`);

    // === GET BEPAID CREDENTIALS (standard pattern: integration_instances > env) ===
    const { data: integrations } = await supabase
      .from("integration_instances")
      .select("config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .limit(1);

    const config = integrations?.[0]?.config as Record<string, any> | null;
    const shopId = config?.shop_id || Deno.env.get("BEPAID_SHOP_ID");
    const secretKey = config?.secret_key || Deno.env.get("BEPAID_SECRET_KEY");

    console.log(`[Sync] Credentials: shopId=${shopId ? 'found' : 'missing'}, secretKey=${secretKey ? 'found' : 'missing'}, source=${config ? 'db' : 'env'}`);

    if (!shopId || !secretKey) {
      return new Response(JSON.stringify({ error: "bePaid credentials not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${shopId}:${secretKey}`);

    // === CREATE RUN RECORD ===
    const startTime = Date.now();
    const { data: runData, error: runError } = await supabase
      .from("payments_sync_runs")
      .insert({
        source_mode: mode,
        period_from: from_date,
        period_to: to_date,
        status: 'running',
        started_at: new Date().toISOString(),
        initiated_by: user.id,
        stats: { dry_run },
      })
      .select()
      .single();

    if (runError) {
      console.error('[Sync] Failed to create run record:', runError);
      return new Response(JSON.stringify({ error: "Failed to create sync run" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runId = runData.id;
    console.log(`[Sync] Created run ${runId}`);

    // === INITIALIZE STATS ===
    const stats: SyncStats = {
      scanned: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
      stopped_reason: null,
      error_samples: [],
      amount_sum_db: 0,
      amount_sum_api: 0,
      diff_count: 0,
      diff_amount: 0,
    };

    let consecutiveErrors = 0;
    let stopped = false;

    try {
      // === FETCH EXISTING PAYMENTS FROM DB ===
      const { data: existingPayments, error: fetchError } = await supabase
        .from("payments_v2")
        .select("id, provider_payment_id, amount, status, transaction_type, paid_at, meta")
        .eq("provider", "bepaid")
        .gte("paid_at", `${from_date}T00:00:00Z`)
        .lte("paid_at", `${to_date}T23:59:59Z`)
        .order("paid_at", { ascending: true });

      if (fetchError) {
        throw new Error(`Failed to fetch existing payments: ${fetchError.message}`);
      }

      const payments = existingPayments || [];
      console.log(`[Sync] Found ${payments.length} payments in DB for period`);

      // Calculate initial DB sum
      for (const p of payments) {
        stats.amount_sum_db += Number(p.amount) || 0;
      }

      // === PROCESS PAYMENTS ===
      const uidToPayment = new Map(payments.map(p => [p.provider_payment_id, p]));
      
      // Process in batches with concurrency
      for (let i = 0; i < payments.length; i += batch_size) {
        if (stopped) break;

        const batch = payments.slice(i, i + batch_size);
        
        // Process batch with limited concurrency
        const results = await Promise.allSettled(
          batch.map(async (payment) => {
            const uid = payment.provider_payment_id;
            if (!uid) {
              stats.errors++;
              return { uid: 'unknown', status: 'error', error: 'Missing UID' };
            }

            stats.scanned++;

            // Fetch from bePaid API
            const { tx: rawTx, error: fetchErr } = await fetchTransactionByUid(uid, shopId, auth);
            
            if (fetchErr || !rawTx) {
              consecutiveErrors++;
              stats.errors++;
              if (stats.error_samples.length < 10) {
                stats.error_samples.push({ uid, error: fetchErr || 'Not found' });
              }
              
              // STOP if too many consecutive errors
              if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                stopped = true;
                stats.stopped_reason = `STOP: ${MAX_CONSECUTIVE_ERRORS} consecutive errors`;
              }
              
              return { uid, status: 'error', error: fetchErr };
            }

            consecutiveErrors = 0; // Reset on success

            // Normalize transaction
            const { tx: normalized, error: normalizeErr } = normalizeTx(rawTx);
            
            if (normalizeErr || !normalized) {
              stats.errors++;
              if (stats.error_samples.length < 10) {
                stats.error_samples.push({ uid, error: normalizeErr || 'Normalization failed' });
              }
              
              // STOP on currency mismatch
              if (normalizeErr?.includes('Currency') || normalizeErr?.includes('STOP')) {
                stopped = true;
                stats.stopped_reason = normalizeErr;
              }
              
              return { uid, status: 'error', error: normalizeErr };
            }

            stats.amount_sum_api += normalized.amount;

            // Compare with DB
            const dbPayment = payment;
            const dbAmount = Number(dbPayment.amount);
            const apiAmount = normalized.amount;
            const diff = Math.abs(dbAmount - apiAmount);

            // STOP if delta too large
            if (diff > MAX_DELTA_PER_TX_BYN) {
              stopped = true;
              stats.stopped_reason = `STOP: Delta ${diff.toFixed(2)} BYN exceeds threshold ${MAX_DELTA_PER_TX_BYN} for UID ${uid}`;
              return { uid, status: 'stopped', error: stats.stopped_reason };
            }

            if (diff > 0.01) {
              stats.diff_count++;
              stats.diff_amount += (apiAmount - dbAmount);
            }

            // Check if update needed
            const needsUpdate = 
              diff > 0.01 ||
              dbPayment.status !== normalized.status ||
              dbPayment.transaction_type !== normalized.transaction_type;

            if (!needsUpdate) {
              stats.unchanged++;
              return { uid, status: 'unchanged' };
            }

            if (dry_run) {
              stats.updated++;
              return { uid, status: 'would_update', diff };
            }

            // Execute update
            const { error: updateError } = await supabase
              .from("payments_v2")
              .update({
                amount: normalized.amount,
                status: normalized.status,
                transaction_type: normalized.transaction_type,
                card_last4: normalized.card_last4 || dbPayment.meta?.card_last4,
                card_brand: normalized.card_brand || dbPayment.meta?.card_brand,
                updated_at: new Date().toISOString(),
                meta: {
                  ...dbPayment.meta,
                  last_synced_at: new Date().toISOString(),
                  sync_run_id: runId,
                  previous_amount: dbAmount,
                  sync_source: 'bepaid_api',
                },
              })
              .eq("id", dbPayment.id);

            if (updateError) {
              stats.errors++;
              if (stats.error_samples.length < 10) {
                stats.error_samples.push({ uid, error: updateError.message });
              }
              return { uid, status: 'error', error: updateError.message };
            }

            stats.updated++;
            return { uid, status: 'updated', diff };
          })
        );

        // Update progress
        const progress = Math.round(((i + batch.length) / payments.length) * 100);
        await supabase
          .from("payments_sync_runs")
          .update({
            processed_pages: Math.ceil((i + batch.length) / batch_size),
            total_pages: Math.ceil(payments.length / batch_size),
            stats: { ...stats, progress },
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);

        console.log(`[Sync] Progress: ${i + batch.length}/${payments.length} (${progress}%)`);
      }

      // === FINALIZE ===
      const finalStatus = stopped ? 'stopped' : 'success';
      const duration = Date.now() - startTime;

      await supabase
        .from("payments_sync_runs")
        .update({
          status: finalStatus,
          finished_at: new Date().toISOString(),
          stats: {
            ...stats,
            duration_ms: duration,
          },
        })
        .eq("id", runId);

      // === AUDIT LOG ===
      await supabase.from("audit_logs").insert({
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid-sync-orchestrator',
        action: 'payments_sync_run',
        meta: {
          run_id: runId,
          mode,
          period: { from_date, to_date },
          dry_run,
          stats,
          duration_ms: duration,
          initiated_by: user.id,
        },
      });

      console.log(`[Sync] Completed run ${runId}: ${JSON.stringify(stats)}`);

      return new Response(JSON.stringify({
        success: !stopped,
        run_id: runId,
        status: finalStatus,
        dry_run,
        stats,
        duration_ms: duration,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (err: unknown) {
      // === ERROR HANDLING ===
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Sync] Fatal error:`, err);

      await supabase
        .from("payments_sync_runs")
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: message,
          stats,
        })
        .eq("id", runId);

      return new Response(JSON.stringify({
        success: false,
        run_id: runId,
        status: 'failed',
        error: message,
        stats,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Outer error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
