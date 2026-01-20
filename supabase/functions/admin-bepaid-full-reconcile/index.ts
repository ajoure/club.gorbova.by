import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * admin-bepaid-full-reconcile
 * 
 * Full reconciliation of bePaid transactions with payments_v2.
 * bePaid is the source of truth - adds missing, fixes amounts/statuses.
 * 
 * NEW IN THIS VERSION:
 * - normalizeCardBrand: Canonical brand normalization (master -> mastercard)
 * - Backfill card_last4/card_brand for existing records
 * - Refund card inheritance from parent payments
 * - fetchTransactionDetails: Detail fetch for missing card data
 * 
 * STOP GUARDS:
 * - Admin-only (has_role check)
 * - dry_run=true by default
 * - Max 5000 transactions per run
 * - Timeout protection with cursor_next
 * - Never deletes payments (only INSERT/UPDATE)
 * - Original values preserved in meta.reconcile_original
 */

interface ReconcileRequest {
  from_date?: string;      // default: '2026-01-01'
  to_date?: string;        // default: today
  dry_run?: boolean;       // default: true
  limit?: number;          // max transactions per run (default 2000, max 5000)
  cursor?: string | null;  // continuation token
  allow_over_limit?: boolean; // bypass limit check
}

interface ReconcileResponse {
  ok: boolean;
  dry_run: boolean;
  period: { from_date: string; to_date: string };
  fetched: {
    bepaid_total: number;
    pages: number;
    cursor_next: string | null;
  };
  compared: { our_total: number };
  changes: {
    added: number;
    updated_amount: number;
    updated_status: number;
    updated_paid_at: number;
    updated_card_fields: number;    // NEW: backfilled card_last4/brand
    brand_normalized: number;        // NEW: 'master' -> 'mastercard'
    refunds_card_filled: number;     // NEW: refunds with inherited card data
    unchanged: number;
    errors: number;
  };
  samples: {
    added: Array<{ uid: string; amount: number; status: string; paid_at: string }>;
    discrepancies_amount: Array<{ uid: string; our_amount: number; bepaid_amount: number; fixed: boolean }>;
    discrepancies_status: Array<{ uid: string; our_status: string; bepaid_status: string; fixed: boolean }>;
    discrepancies_paid_at: Array<{ uid: string; our_paid_at: string; bepaid_paid_at: string; fixed: boolean }>;
    card_backfilled: Array<{ uid: string; field: string; old_value: string | null; new_value: string }>;
    errors: Array<{ uid: string; error: string }>;
  };
  error?: string;
}

// Normalize bePaid status to our payment_status enum
function normalizeStatus(status: string): 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'canceled' {
  switch (status?.toLowerCase()) {
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
      return 'processing';
    case 'pending':
      return 'pending';
    case 'refunded':
    case 'voided':
      return 'refunded';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'pending';
  }
}

// Normalize card brand to canonical format
function normalizeCardBrand(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const lower = brand.toLowerCase().trim();
  const brandMap: Record<string, string> = {
    'master': 'mastercard',
    'mc': 'mastercard',
    'mastercard': 'mastercard',
    'visa': 'visa',
    'belkart': 'belkart',
    'belcard': 'belkart',
    'maestro': 'maestro',
    'mir': 'mir',
  };
  return brandMap[lower] || lower;
}

// Normalize last4 - strip non-digits, take last 4
function normalizeLast4(last4: string | null | undefined): string | null {
  if (!last4) return null;
  const cleaned = last4.replace(/\D/g, '').slice(-4);
  return cleaned.length === 4 ? cleaned : null;
}

// Format date for bePaid Reports API
function formatBepaidDate(d: Date): string {
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// Fetch transaction details by UID from bePaid
async function fetchTransactionDetails(auth: string, uid: string): Promise<any | null> {
  const endpoints = [
    `https://gateway.bepaid.by/transactions/${uid}`,
    `https://api.bepaid.by/transactions/${uid}`,
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "X-Api-Version": "3",
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.transaction || data;
      }
    } catch (err) {
      console.error(`[full-reconcile] Detail fetch error for ${uid}:`, err);
    }
  }
  return null;
}

// Fetch transactions from bePaid Reports API
async function fetchFromBepaid(
  auth: string,
  fromDate: Date,
  toDate: Date,
  maxTransactions: number,
  startTime: number
): Promise<{ success: boolean; transactions: any[]; error?: string; pages: number }> {
  const endpoints = [
    "https://gateway.bepaid.by/transactions",
    "https://api.bepaid.by/transactions",
  ];

  const fromDateISO = fromDate.toISOString();
  const toDateISO = toDate.toISOString();
  
  let allTransactions: any[] = [];
  let pages = 0;
  let hasMore = true;
  let currentPage = 1;
  const perPage = 100;
  const maxPages = Math.ceil(maxTransactions / perPage);
  const maxRuntimeMs = 50000; // 50 seconds timeout protection

  for (const endpoint of endpoints) {
    console.log(`[full-reconcile] Trying endpoint: ${endpoint}`);
    
    try {
      allTransactions = [];
      pages = 0;
      hasMore = true;
      currentPage = 1;

      while (hasMore && pages < maxPages && allTransactions.length < maxTransactions) {
        // Timeout protection
        if (Date.now() - startTime > maxRuntimeMs) {
          console.log(`[full-reconcile] Timeout protection triggered at page ${currentPage}`);
          return {
            success: true,
            transactions: allTransactions,
            pages,
            error: `Timeout after ${pages} pages, ${allTransactions.length} transactions`
          };
        }

        const url = `${endpoint}?created_at_from=${encodeURIComponent(fromDateISO)}&created_at_to=${encodeURIComponent(toDateISO)}&per_page=${perPage}&page=${currentPage}`;
        
        console.log(`[full-reconcile] Fetching page ${currentPage}: ${url}`);
        
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "X-Api-Version": "3",
          },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            console.log(`[full-reconcile] Auth failed for ${endpoint}`);
            break; // Try next endpoint
          }
          const errText = await response.text();
          console.log(`[full-reconcile] Error ${response.status}: ${errText.substring(0, 200)}`);
          break;
        }

        const data = await response.json();
        const transactions = data.transactions || data.data?.transactions || [];
        
        console.log(`[full-reconcile] Page ${currentPage}: got ${transactions.length} transactions`);
        
        if (transactions.length === 0) {
          hasMore = false;
        } else {
          allTransactions.push(...transactions);
          pages++;
          currentPage++;
          
          if (transactions.length < perPage) {
            hasMore = false;
          }
        }
      }

      if (allTransactions.length > 0) {
        console.log(`[full-reconcile] Success: ${allTransactions.length} transactions from ${endpoint}`);
        return { success: true, transactions: allTransactions, pages };
      }
    } catch (err) {
      console.error(`[full-reconcile] Error with ${endpoint}:`, err);
    }
  }

  // Fallback: try Reports API (POST)
  console.log(`[full-reconcile] Falling back to Reports API`);
  const reportsEndpoints = [
    "https://api.bepaid.by/api/reports",
    "https://gateway.bepaid.by/api/reports",
  ];

  const requestBody = {
    report_params: {
      date_type: "created_at",
      from: formatBepaidDate(fromDate),
      to: formatBepaidDate(toDate),
      status: "all",
      payment_method_type: "all",
      time_zone: "Europe/Minsk"
    }
  };

  for (const endpoint of reportsEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Api-Version": "2",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = await response.json();
        const transactions = data.transactions || data.data?.transactions || data.items || [];
        if (transactions.length > 0) {
          console.log(`[full-reconcile] Reports API success: ${transactions.length} transactions`);
          return { success: true, transactions: transactions.slice(0, maxTransactions), pages: 1 };
        }
      }
    } catch (err) {
      console.error(`[full-reconcile] Reports API error:`, err);
    }
  }

  return { success: false, transactions: [], error: "All bePaid endpoints failed", pages: 0 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // 1. Auth check - admin only
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: hasAdminRole } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'admin' 
    });
    if (!hasAdminRole) {
      return new Response(JSON.stringify({ ok: false, error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse request
    const body: ReconcileRequest = await req.json().catch(() => ({}));
    const from_date = body.from_date || '2026-01-01';
    const to_date = body.to_date || new Date().toISOString().split('T')[0];
    const dry_run = body.dry_run !== false; // Default true
    const requestedLimit = body.limit || 2000;
    const limit = body.allow_over_limit ? Math.min(requestedLimit, 10000) : Math.min(requestedLimit, 5000);

    console.log(`[full-reconcile] Starting: from=${from_date}, to=${to_date}, dry_run=${dry_run}, limit=${limit}`);

    // 3. Get bePaid credentials
    const { data: bepaidInstance } = await supabase
      .from("integration_instances")
      .select("id, config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      return new Response(JSON.stringify({ ok: false, error: "No bePaid integration configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = bepaidInstance.config.shop_id;
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");
    
    if (!shopId || !secretKey) {
      return new Response(JSON.stringify({ ok: false, error: "Missing bePaid credentials" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${shopId}:${secretKey}`);

    // 4. Calculate date range with timezone buffer
    const fromDate = new Date(`${from_date}T00:00:00Z`);
    fromDate.setHours(fromDate.getHours() - 12); // -12h buffer for timezone
    
    const toDate = new Date(`${to_date}T23:59:59Z`);
    toDate.setHours(toDate.getHours() + 12); // +12h buffer for timezone

    console.log(`[full-reconcile] Date range with buffer: ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    // 5. Fetch transactions from bePaid
    const { success: fetchSuccess, transactions: bepaidTx, error: fetchError, pages } = 
      await fetchFromBepaid(auth, fromDate, toDate, limit, startTime);

    if (!fetchSuccess || bepaidTx.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: fetchError || "No transactions found in bePaid",
        dry_run,
        period: { from_date, to_date },
        fetched: { bepaid_total: 0, pages: 0, cursor_next: null },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[full-reconcile] Fetched ${bepaidTx.length} transactions from bePaid`);

    // 6. Get our payments for the period (include card fields for backfill check)
    const { data: ourPayments, error: ourError } = await supabase
      .from("payments_v2")
      .select("id, provider_payment_id, amount, status, paid_at, card_last4, card_brand, meta")
      .gte("paid_at", from_date)
      .lte("paid_at", to_date + "T23:59:59Z");

    if (ourError) {
      console.error("[full-reconcile] Error fetching our payments:", ourError);
    }

    const ourMap = new Map((ourPayments || []).map(p => [p.provider_payment_id, p]));
    console.log(`[full-reconcile] Found ${ourMap.size} payments in our DB for this period`);

    // 7. Compare and reconcile
    const result: ReconcileResponse = {
      ok: true,
      dry_run,
      period: { from_date, to_date },
      fetched: {
        bepaid_total: bepaidTx.length,
        pages,
        cursor_next: bepaidTx.length >= limit ? "continue" : null,
      },
      compared: { our_total: ourMap.size },
      changes: {
        added: 0,
        updated_amount: 0,
        updated_status: 0,
        updated_paid_at: 0,
        updated_card_fields: 0,
        brand_normalized: 0,
        refunds_card_filled: 0,
        unchanged: 0,
        errors: 0,
      },
      samples: {
        added: [],
        discrepancies_amount: [],
        discrepancies_status: [],
        discrepancies_paid_at: [],
        card_backfilled: [],
        errors: [],
      },
    };

    const maxSamples = 20;
    const processedUids = new Set<string>();

    for (const beTx of bepaidTx) {
      const uid = beTx.uid || beTx.id;
      
      if (!uid || processedUids.has(uid)) continue;
      processedUids.add(uid);

      try {
        const bepaidAmount = Number(beTx.amount) / 100; // kopeks to rubles
        const bepaidStatus = normalizeStatus(beTx.status);
        const bepaidPaidAt = beTx.created_at || beTx.paid_at || beTx.completed_at;

        // Extract card data from bePaid transaction
        let bepaidCardLast4 = normalizeLast4(beTx.credit_card?.last_4 || beTx.card?.last_4);
        let bepaidCardBrand = normalizeCardBrand(beTx.credit_card?.brand || beTx.card?.brand);
        
        // Determine if this is a refund transaction
        const txType = beTx.type?.toLowerCase() || beTx.transaction_type?.toLowerCase() || '';
        const isRefund = ['refund', 'void', 'credit'].includes(txType) || 
                         bepaidStatus === 'refunded';

        // For refunds missing card data, try to get from parent
        if (isRefund && !bepaidCardLast4) {
          const parentUid = beTx.parent_uid || beTx.parent_transaction_uid || beTx.original_transaction?.uid;
          
          if (parentUid) {
            // First check our DB for parent
            const { data: parentPayment } = await supabase
              .from("payments_v2")
              .select("card_last4, card_brand")
              .eq("provider_payment_id", parentUid)
              .maybeSingle();
            
            if (parentPayment?.card_last4) {
              bepaidCardLast4 = normalizeLast4(parentPayment.card_last4);
              bepaidCardBrand = normalizeCardBrand(parentPayment.card_brand);
              result.changes.refunds_card_filled++;
            }
          }
          
          // If still missing, fetch details from bePaid
          if (!bepaidCardLast4) {
            const detailTx = await fetchTransactionDetails(auth, uid);
            if (detailTx) {
              if (detailTx.credit_card?.last_4) {
                bepaidCardLast4 = normalizeLast4(detailTx.credit_card.last_4);
                bepaidCardBrand = normalizeCardBrand(detailTx.credit_card.brand);
                result.changes.refunds_card_filled++;
              } else if (detailTx.parent_uid || detailTx.parent_transaction_uid) {
                // Try to get from parent via API
                const parentDetailUid = detailTx.parent_uid || detailTx.parent_transaction_uid;
                const parentDetailTx = await fetchTransactionDetails(auth, parentDetailUid);
                if (parentDetailTx?.credit_card?.last_4) {
                  bepaidCardLast4 = normalizeLast4(parentDetailTx.credit_card.last_4);
                  bepaidCardBrand = normalizeCardBrand(parentDetailTx.credit_card.brand);
                  result.changes.refunds_card_filled++;
                }
              }
            }
          }
        }

        const ourPayment = ourMap.get(uid);

        if (!ourPayment) {
          // New payment - INSERT
          result.changes.added++;
          
          if (result.samples.added.length < maxSamples) {
            result.samples.added.push({
              uid,
              amount: bepaidAmount,
              status: bepaidStatus,
              paid_at: bepaidPaidAt,
            });
          }

          if (!dry_run) {
            // Extract additional data from bePaid transaction
            const productName = beTx.description || beTx.order?.description || null;
            const trackingId = beTx.tracking_id;
            
            // Try to parse order_id from tracking_id
            let orderId = null;
            if (trackingId) {
              const parts = trackingId.split("_");
              const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (parts.length >= 1 && uuidRegex.test(parts[0])) {
                orderId = parts[0];
              }
            }

            const { error: insertError } = await supabase
              .from("payments_v2")
              .insert({
                provider_payment_id: uid,
                provider: "bepaid",
                amount: bepaidAmount,
                currency: beTx.currency || "BYN",
                status: bepaidStatus,
                paid_at: bepaidPaidAt,
                card_last4: bepaidCardLast4,
                card_brand: bepaidCardBrand,
                transaction_type: isRefund ? 'refund' : (beTx.type || beTx.transaction_type || 'payment'),
                product_name_raw: productName,
                order_id: orderId,
                meta: {
                  tracking_id: trackingId,
                  bepaid_raw: beTx,
                  reconcile_source: "admin-bepaid-full-reconcile",
                  reconcile_at: new Date().toISOString(),
                },
              });

            if (insertError) {
              console.error(`[full-reconcile] Insert error for ${uid}:`, insertError);
              result.changes.added--;
              result.changes.errors++;
              if (result.samples.errors.length < maxSamples) {
                result.samples.errors.push({ uid, error: insertError.message });
              }
            }
          }
        } else {
          // Existing payment - check for discrepancies
          let hasChanges = false;
          const updates: Record<string, any> = {};
          const originalValues: Record<string, any> = {};

          // Check amount
          const amountDiff = Math.abs(ourPayment.amount - bepaidAmount);
          if (amountDiff > 0.01) {
            originalValues.amount = ourPayment.amount;
            updates.amount = bepaidAmount;
            result.changes.updated_amount++;
            hasChanges = true;
            
            if (result.samples.discrepancies_amount.length < maxSamples) {
              result.samples.discrepancies_amount.push({
                uid,
                our_amount: ourPayment.amount,
                bepaid_amount: bepaidAmount,
                fixed: !dry_run,
              });
            }
          }

          // Check status
          if (ourPayment.status !== bepaidStatus) {
            originalValues.status = ourPayment.status;
            updates.status = bepaidStatus;
            result.changes.updated_status++;
            hasChanges = true;
            
            if (result.samples.discrepancies_status.length < maxSamples) {
              result.samples.discrepancies_status.push({
                uid,
                our_status: ourPayment.status,
                bepaid_status: bepaidStatus,
                fixed: !dry_run,
              });
            }
          }

          // Check paid_at (allow 1 minute tolerance)
          if (bepaidPaidAt && ourPayment.paid_at) {
            const ourDate = new Date(ourPayment.paid_at).getTime();
            const bepaidDate = new Date(bepaidPaidAt).getTime();
            if (Math.abs(ourDate - bepaidDate) > 60000) { // > 1 minute difference
              originalValues.paid_at = ourPayment.paid_at;
              updates.paid_at = bepaidPaidAt;
              result.changes.updated_paid_at++;
              hasChanges = true;
              
              if (result.samples.discrepancies_paid_at.length < maxSamples) {
                result.samples.discrepancies_paid_at.push({
                  uid,
                  our_paid_at: ourPayment.paid_at,
                  bepaid_paid_at: bepaidPaidAt,
                  fixed: !dry_run,
                });
              }
            }
          }

          // ========== CARD BACKFILL LOGIC ==========
          
          // Backfill card_last4 if missing
          if (bepaidCardLast4 && !ourPayment.card_last4) {
            updates.card_last4 = bepaidCardLast4;
            result.changes.updated_card_fields++;
            hasChanges = true;
            
            if (result.samples.card_backfilled.length < maxSamples) {
              result.samples.card_backfilled.push({
                uid,
                field: 'card_last4',
                old_value: ourPayment.card_last4,
                new_value: bepaidCardLast4,
              });
            }
          }

          // Backfill or normalize card_brand
          if (bepaidCardBrand) {
            const currentNormalized = normalizeCardBrand(ourPayment.card_brand);
            
            if (!ourPayment.card_brand) {
              // Missing card_brand - backfill
              updates.card_brand = bepaidCardBrand;
              result.changes.updated_card_fields++;
              hasChanges = true;
              
              if (result.samples.card_backfilled.length < maxSamples) {
                result.samples.card_backfilled.push({
                  uid,
                  field: 'card_brand',
                  old_value: null,
                  new_value: bepaidCardBrand,
                });
              }
            } else if (ourPayment.card_brand !== bepaidCardBrand && currentNormalized === bepaidCardBrand) {
              // Brand needs normalization (e.g., 'master' -> 'mastercard')
              originalValues.card_brand = ourPayment.card_brand;
              updates.card_brand = bepaidCardBrand;
              result.changes.brand_normalized++;
              hasChanges = true;
              
              if (result.samples.card_backfilled.length < maxSamples) {
                result.samples.card_backfilled.push({
                  uid,
                  field: 'card_brand_normalized',
                  old_value: ourPayment.card_brand,
                  new_value: bepaidCardBrand,
                });
              }
            }
          }

          if (hasChanges && !dry_run) {
            // Preserve original values in meta
            updates.meta = {
              ...(ourPayment.meta || {}),
              reconcile_original: {
                ...(ourPayment.meta?.reconcile_original || {}),
                ...originalValues,
              },
              reconcile_at: new Date().toISOString(),
              reconcile_source: "admin-bepaid-full-reconcile",
            };
            updates.updated_at = new Date().toISOString();

            const { error: updateError } = await supabase
              .from("payments_v2")
              .update(updates)
              .eq("id", ourPayment.id);

            if (updateError) {
              console.error(`[full-reconcile] Update error for ${uid}:`, updateError);
              result.changes.errors++;
              if (result.samples.errors.length < maxSamples) {
                result.samples.errors.push({ uid, error: updateError.message });
              }
            }
          }

          if (!hasChanges) {
            result.changes.unchanged++;
          }
        }
      } catch (err: any) {
        console.error(`[full-reconcile] Error processing ${uid}:`, err);
        result.changes.errors++;
        if (result.samples.errors.length < maxSamples) {
          result.samples.errors.push({ uid, error: err.message });
        }
      }
    }

    // 8. Write audit log (SYSTEM ACTOR) - only on execute
    if (!dry_run) {
      await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_label: "admin-bepaid-full-reconcile",
        actor_user_id: null,
        action: "bepaid_full_reconcile",
        meta: {
          triggered_by: user.id,
          period: { from_date, to_date },
          dry_run: false,
          bepaid_total: result.fetched.bepaid_total,
          our_total: result.compared.our_total,
          changes: result.changes,
          sample_uids_added: result.samples.added.slice(0, 5).map(s => s.uid),
          sample_uids_fixed_amount: result.samples.discrepancies_amount.slice(0, 5).map(s => s.uid),
          sample_uids_fixed_status: result.samples.discrepancies_status.slice(0, 5).map(s => s.uid),
          sample_uids_card_backfilled: result.samples.card_backfilled.slice(0, 5).map(s => s.uid),
          runtime_ms: Date.now() - startTime,
        },
      });
    }

    const runtime = Date.now() - startTime;
    console.log(`[full-reconcile] Completed in ${runtime}ms: added=${result.changes.added}, updated_amount=${result.changes.updated_amount}, updated_status=${result.changes.updated_status}, updated_card_fields=${result.changes.updated_card_fields}, brand_normalized=${result.changes.brand_normalized}, refunds_card_filled=${result.changes.refunds_card_filled}, unchanged=${result.changes.unchanged}, errors=${result.changes.errors}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[full-reconcile] Critical error:", err);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: err.message,
      dry_run: true,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
