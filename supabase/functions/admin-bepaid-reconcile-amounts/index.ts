import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from "npm:@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type UidKindGuess = 'transaction_uid' | 'tracking_id' | 'unknown';

interface ReconcileParams {
  from_date?: string; // YYYY-MM-DD
  to_date?: string;
  dry_run?: boolean;
  filter_only_amount_1?: boolean;
  batch_size?: number;
  max_payments_to_check?: number; // hard stop, independent from batch_size
}

interface Discrepancy {
  payment_id: string;
  provider_payment_id: string | null;
  order_id: string | null;
  our_amount: number;
  bepaid_amount: number;
  transaction_type: string;
  status: string;
  paid_at: string;
  customer_email: string | null;
  bepaid_http_status?: number;
  bepaid_endpoint?: string;
}

interface NotFoundDetail {
  payment_id: string;
  provider_payment_id: string;
  endpoints_tried: string[];
  last_http_status: number;
  uid_kind_guess: UidKindGuess;
  /** When we have a specific endpoint/status worth surfacing (e.g. 200 but unparseable) */
  endpoint_used?: string;
  http_status?: number;
  matched_shape?: string;
  last_error_body_excerpt?: string;
}

interface ErrorFetchDetail {
  payment_id: string;
  provider_payment_id: string;
  endpoints_tried: string[];
  last_http_status: number;
  uid_kind_guess: UidKindGuess;
  endpoint_used?: string;
  http_status?: number;
  matched_shape?: string;
  last_error_body_excerpt?: string;
}

interface FetchedDetail {
  payment_id: string;
  provider_payment_id: string;
  endpoints_tried: string[];
  last_http_status: number;
  bepaid_endpoint: string;
  bepaid_http_status: number;
  matched_shape?: string;
  tx_uid: string | null;
  tx_id: string | null;
  uid_kind_guess: UidKindGuess;
}

interface ReconcileResult {
  checked: number;
  discrepancies_found: number;
  fixed: number;
  skipped: number; // missing provider_payment_id
  not_found: number; // uid present but API 404/null on all endpoints
  errors: number; // non-404 failures
  discrepancies: Discrepancy[];
  fetched_details: FetchedDetail[]; // first 20 fetched transactions (even if no discrepancy)
  not_found_details: NotFoundDetail[]; // first 20
  error_fetch_details: ErrorFetchDetail[]; // first 20
  error_details: Array<{ payment_id: string; error: string }>;
}

interface FetchResult {
  outcome: 'fetched' | 'not_found' | 'error';

  tx: any | null;
  endpoint?: string; // only set when tx was successfully parsed
  status?: number; // only set when tx was successfully parsed
  matched_shape?: string; // which response shape matched for tx

  endpoints_tried: string[];
  last_http_status: number;

  // Diagnostics
  endpoint_used?: string; // last relevant endpoint for outcome
  http_status?: number; // http status for endpoint_used
  last_error_body_excerpt?: string; // first 200 chars (safe)
}

// PATCH-P0.9.1: Removed custom getBepaidCredentials in favor of getBepaidCredsStrict

function guessUidKind(uid: string): UidKindGuess {
  const isTransactionUid = /^\d{4}-[0-9a-f]{10}$/i.test(uid);
  if (isTransactionUid) return 'transaction_uid';

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
  if (isUuid) return 'tracking_id';

  return 'unknown';
}

async function fetchTransaction(
  uid: string,
  authString: string,
  opts?: {
    shopId?: string;
    paid_at?: string;
    amount_byn?: number;
    order_id?: string | null;
    payment_id?: string;
  }
): Promise<FetchResult> {
  // Try multiple endpoint patterns - the uid might be a transaction uid or a tracking_id
  // Keep max_endpoints_per_payment = 4

  const buildListSearchEndpoint = (): string | null => {
    if (!opts?.paid_at) return null;

    const paidAt = new Date(opts.paid_at);
    if (Number.isNaN(paidAt.getTime())) return null;

    const from = new Date(paidAt.getTime() - 12 * 60 * 60 * 1000);
    const to = new Date(paidAt.getTime() + 12 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      created_at_from: from.toISOString(),
      created_at_to: to.toISOString(),
      per_page: '100',
      ...(opts.shopId ? { shop_id: String(opts.shopId) } : {}),
    });

    // Use gateway endpoint (most likely to work; used by bepai-fetch probe order)
    return `https://gateway.bepaid.by/transactions?${params.toString()}`;
  };

  const listSearchEndpoint = buildListSearchEndpoint();

  // Deterministic endpoint order (max 4, no slice):
  // 1) gateway uid
  // 2) gateway tracking_id
  // 3) list search (only if built)
  // 4) api uid
  const endpoints: string[] = [
    `https://gateway.bepaid.by/transactions/${uid}`,
    `https://gateway.bepaid.by/v2/transactions/tracking_id/${uid}`,
    ...(listSearchEndpoint ? [listSearchEndpoint] : []),
    `https://api.bepaid.by/v2/transactions/${uid}`,
  ];

  const tried: string[] = [];

  // Not-found signals include:
  // - HTTP 404
  // - tracking_id endpoint: HTTP 200 with {"transactions": []}
  // - list endpoint: transactions[] empty OR none match uid/order/payment/amount
  let lastNotFoundEndpoint: string | undefined;
  let lastNotFoundStatus: number | undefined;
  let lastNotFoundExcerpt: string | undefined;
  let lastNotFoundShape: string | undefined;

  // Error signals include:
  // - non-404 non-2xx statuses (401/403/5xx)
  // - invalid JSON
  // - network exceptions
  // - res.ok but unparseable tx for non-list endpoints
  let lastErrorEndpoint: string | undefined;
  let lastErrorStatus: number | undefined;
  let lastErrorExcerpt: string | undefined;
  let lastErrorShape: string | undefined;

  const recordNotFound = (endpoint: string, status: number, shape: string, excerpt?: string) => {
    lastNotFoundEndpoint = endpoint;
    lastNotFoundStatus = status;
    lastNotFoundShape = shape;
    lastNotFoundExcerpt = excerpt;
  };

  const recordError = (endpoint: string, status: number, shape: string, excerpt?: string) => {
    lastErrorEndpoint = endpoint;
    lastErrorStatus = status;
    lastErrorShape = shape;
    lastErrorExcerpt = excerpt;
  };

  const extractTxFromKnownShapes = (data: any): { tx: any | null; matched_shape?: string } => {
    // 0) DIRECT TRANSACTION: bePaid Gateway format with uid at root level
    //    This is the most common format from single-transaction endpoints
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const hasUid = typeof data.uid === 'string' && data.uid.length > 0;
      const hasAmount = typeof data.amount === 'number';
      const hasStatus = typeof data.status === 'string';
      
      // Strong signal: uid + (amount OR status) = direct transaction
      if (hasUid && (hasAmount || hasStatus)) {
        return { tx: data, matched_shape: 'direct_transaction' };
      }
    }

    // 1) data.transaction
    if (data?.transaction && typeof data.transaction === 'object') {
      return { tx: data.transaction, matched_shape: 'data.transaction' };
    }

    // 2) data.data.transaction
    if (data?.data?.transaction && typeof data.data.transaction === 'object') {
      return { tx: data.data.transaction, matched_shape: 'data.data.transaction' };
    }

    // 3) data.data (if it is the transaction)
    if (data?.data && typeof data.data === 'object') {
      const d = data.data;
      const hasTxnFields = d?.uid || d?.id || d?.amount || d?.type || d?.status;
      if (hasTxnFields) return { tx: d, matched_shape: 'data.data' };
    }

    // 4) data (if it is the transaction) - fallback for other shapes
    if (data && typeof data === 'object') {
      const hasTxnFields = data?.uid || data?.id || data?.amount || data?.type || data?.status;
      if (hasTxnFields) return { tx: data, matched_shape: 'data' };
    }

    return { tx: null, matched_shape: 'no_match' };
  };

  const tryMatchFromTransactionsList = (data: any): { tx: any | null; matched_shape?: string } => {
    const txs: any[] = Array.isArray(data?.transactions) ? data.transactions : [];
    if (!txs.length) return { tx: null, matched_shape: 'list.empty' };

    const candidates = [uid, opts?.order_id ?? undefined, opts?.payment_id ?? undefined]
      .filter(Boolean)
      .map(String);

    // 1) Strict tracking_id match only (no includes/startsWith)
    for (const tx of txs) {
      const trackingId = tx?.tracking_id ?? tx?.trackingId ?? tx?.additional_data?.order_id ?? null;
      if (!trackingId) continue;
      const trackingStr = String(trackingId);
      if (candidates.some((c) => trackingStr === c)) {
        return { tx, matched_shape: 'list.match.tracking_id' };
      }
    }

    // 2) Fallback: amount match (kopecks) WITH extra safety filters
    //    - currency must be BYN
    //    - |created_at - paid_at| <= 2h (must be parseable)
    if (typeof opts?.amount_byn === 'number' && opts?.paid_at) {
      const paidAt = new Date(opts.paid_at);
      if (!Number.isNaN(paidAt.getTime())) {
        const expected = Math.round(opts.amount_byn * 100);
        const maxDiffMs = 2 * 60 * 60 * 1000;

        const amountMatch = txs.find((tx) => {
          if (Number(tx?.amount) !== expected) return false;

          const currency = String(tx?.currency ?? tx?.currency_code ?? tx?.currencyCode ?? '').toUpperCase();
          if (currency !== 'BYN') return false;

          const createdAtRaw = tx?.created_at ?? tx?.createdAt ?? tx?.paid_at ?? tx?.paidAt ?? null;
          if (!createdAtRaw) return false;

          const createdAt = new Date(String(createdAtRaw));
          if (Number.isNaN(createdAt.getTime())) return false;

          return Math.abs(createdAt.getTime() - paidAt.getTime()) <= maxDiffMs;
        });

        if (amountMatch) return { tx: amountMatch, matched_shape: 'list.match.amount' };
      }
    }

    return { tx: null, matched_shape: 'list.no_match' };
  };

  for (const endpoint of endpoints) {
    tried.push(endpoint);

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authString}`,
          Accept: 'application/json',
          'X-Api-Version': '3',
        },
      });

      const status = res.status;

      // 404 is always not-found
      if (status === 404) {
        recordNotFound(endpoint, status, 'http_404');
        // drain body
        try { await res.arrayBuffer(); } catch {}
        continue;
      }

      const bodyText = await res.text();

      // Non-2xx (excluding 404 already handled) is error
      if (!res.ok) {
        recordError(endpoint, status, `http_${status}`, bodyText.substring(0, 200));
        continue;
      }

      // 2xx: must be valid JSON
      let data: any;
      try {
        data = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        recordError(endpoint, status, 'invalid_json', bodyText.substring(0, 200));
        continue;
      }

      // Special-case: tracking_id endpoint returns {"transactions": []} with 200 => NOT_FOUND
      // IMPORTANT: apply ONLY to tracking_id endpoint to avoid short-circuiting list-search
      const isTrackingIdEndpoint = endpoint.includes('/v2/transactions/tracking_id/');
      if (isTrackingIdEndpoint && Array.isArray(data?.transactions) && data.transactions.length === 0) {
        recordNotFound(endpoint, status, 'tracking_id.empty', JSON.stringify(data).substring(0, 200));
        continue;
      }

      // If this is the list-search endpoint, try to match within transactions[]
      if (endpoint.includes('/transactions?')) {
        const extracted = tryMatchFromTransactionsList(data);
        if (!extracted.tx) {
          recordNotFound(endpoint, status, extracted.matched_shape || 'list.no_match', JSON.stringify(data).substring(0, 200));
          continue;
        }

        const tx = extracted.tx;
        const txUid = tx?.uid ?? tx?.transaction_uid ?? tx?.transactionUid ?? null;
        const txId = tx?.id ?? tx?.transaction_id ?? tx?.transactionId ?? null;

        if (!txUid && !txId) {
          recordError(endpoint, status, `${extracted.matched_shape || 'list.match'}_missing_uid_or_id`, JSON.stringify(tx).substring(0, 200));
          continue;
        }

        if (txUid && !tx.uid) tx.uid = txUid;
        if (txId && !tx.id) tx.id = txId;

        return {
          outcome: 'fetched',
          tx,
          endpoint,
          status,
          matched_shape: extracted.matched_shape,
          endpoints_tried: tried,
          last_http_status: status,
        };
      }

      // Normal object endpoints
      const extracted = extractTxFromKnownShapes(data);
      const tx = extracted.tx;
      const txUid = tx?.uid ?? tx?.transaction_uid ?? tx?.transactionUid ?? null;
      const txId = tx?.id ?? tx?.transaction_id ?? tx?.transactionId ?? null;

      if (tx && (txUid || txId)) {
        if (txUid && !tx.uid) tx.uid = txUid;
        if (txId && !tx.id) tx.id = txId;

        return {
          outcome: 'fetched',
          tx,
          endpoint,
          status,
          matched_shape: extracted.matched_shape,
          endpoints_tried: tried,
          last_http_status: status,
        };
      }

      // res.ok but tx missing => ERROR with excerpt (explicit)
      recordError(endpoint, status, `${extracted.matched_shape || 'no_match'}_unparseable`, JSON.stringify(data).substring(0, 200));
      continue;
    } catch (err: any) {
      recordError(endpoint, 0, 'exception', String(err?.message ?? err).substring(0, 200));
      continue;
    }
  }

  // Decide final outcome
  if (lastErrorEndpoint) {
    return {
      outcome: 'error',
      tx: null,
      endpoints_tried: tried,
      last_http_status: lastErrorStatus ?? 0,
      endpoint_used: lastErrorEndpoint,
      http_status: lastErrorStatus,
      matched_shape: lastErrorShape,
      last_error_body_excerpt: lastErrorExcerpt,
    };
  }

  return {
    outcome: 'not_found',
    tx: null,
    endpoints_tried: tried,
    last_http_status: lastNotFoundStatus ?? 404,
    endpoint_used: lastNotFoundEndpoint,
    http_status: lastNotFoundStatus,
    matched_shape: lastNotFoundShape,
    last_error_body_excerpt: lastNotFoundExcerpt,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: hasAdminRole } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });

    if (!hasAdminRole) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'bePaid credentials not configured: ' + credsResult.error,
        debug: {
          checked_statuses: ['active', 'connected'],
          integration_found: false
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bepaidCreds = credsResult;
    const authString = createBepaidAuthHeader(bepaidCreds);
    


    const params: ReconcileParams = await req.json();
    const {
      from_date = '2026-01-01',
      to_date = '2026-12-31',
      dry_run = true,
      filter_only_amount_1 = false,
      batch_size = 200,
      max_payments_to_check = 20,
    } = params;

    const effectiveLimit = Math.min(batch_size, max_payments_to_check);

    console.log(
      `[Reconcile] Starting reconciliation: ${from_date} to ${to_date}, dry_run=${dry_run}, filter_amount_1=${filter_only_amount_1}, batch_size=${batch_size}, max_payments_to_check=${max_payments_to_check}, effective_limit=${effectiveLimit}`
    );

    let query = supabase
      .from('payments_v2')
      .select('id, provider_payment_id, order_id, amount, transaction_type, status, paid_at, meta, profile_id, user_id')
      .eq('provider', 'bepaid')
      .gte('paid_at', `${from_date}T00:00:00Z`)
      .lte('paid_at', `${to_date}T23:59:59Z`)
      .order('paid_at', { ascending: false })
      .limit(effectiveLimit);

    if (filter_only_amount_1) {
      query = query.eq('amount', 1);
    }

    const { data: payments, error: paymentsError } = await query;

    if (paymentsError) {
      throw new Error(`Failed to fetch payments: ${paymentsError.message}`);
    }

    console.log(`[Reconcile] Found ${payments?.length || 0} payments to check`);

    const result: ReconcileResult = {
      checked: 0,
      discrepancies_found: 0,
      fixed: 0,
      skipped: 0,
      not_found: 0,
      errors: 0,
      discrepancies: [],
      fetched_details: [],
      not_found_details: [],
      error_fetch_details: [],
      error_details: [],
    };

    const authString = btoa(`${credentials.shopId}:${credentials.secretKey}`);

    for (const payment of payments || []) {
      if (result.checked >= max_payments_to_check) {
        break;
      }

      result.checked++;

      const uid = payment.provider_payment_id as string | null;
      const uidKind: UidKindGuess = uid ? guessUidKind(uid) : 'unknown';

      if (!uid) {
        result.skipped++;
        continue;
      }


      try {
        const fetched = await fetchTransaction(uid, authString, {
          shopId: credentials.shopId,
          paid_at: payment.paid_at,
          amount_byn: Number(payment.amount),
          order_id: payment.order_id,
          payment_id: payment.id,
        });
        
        if (!fetched.tx) {
          if (fetched.outcome === 'not_found') {
            result.not_found++;
            if (result.not_found_details.length < 20) {
              result.not_found_details.push({
                payment_id: payment.id,
                provider_payment_id: uid,
                endpoints_tried: fetched.endpoints_tried,
                last_http_status: fetched.last_http_status,
                uid_kind_guess: uidKind,
                endpoint_used: fetched.endpoint_used,
                http_status: fetched.http_status,
                matched_shape: fetched.matched_shape,
                last_error_body_excerpt: fetched.last_error_body_excerpt,
              });
            }
          } else {
            result.errors++;
            if (result.error_fetch_details.length < 20) {
              result.error_fetch_details.push({
                payment_id: payment.id,
                provider_payment_id: uid,
                endpoints_tried: fetched.endpoints_tried,
                last_http_status: fetched.last_http_status,
                uid_kind_guess: uidKind,
                endpoint_used: fetched.endpoint_used,
                http_status: fetched.http_status,
                matched_shape: fetched.matched_shape,
                last_error_body_excerpt: fetched.last_error_body_excerpt,
              });
            }
          }

          continue;
        }

        const tx = fetched.tx;

        if (result.fetched_details.length < 20 && fetched.endpoint && fetched.status) {
          const txUid = tx?.uid ?? tx?.transaction_uid ?? tx?.transactionUid ?? null;
          const txId = tx?.id ?? tx?.transaction_id ?? tx?.transactionId ?? null;

          result.fetched_details.push({
            payment_id: payment.id,
            provider_payment_id: uid,
            endpoints_tried: fetched.endpoints_tried,
            last_http_status: fetched.last_http_status,
            bepaid_endpoint: fetched.endpoint,
            bepaid_http_status: fetched.status,
            matched_shape: fetched.matched_shape,
            tx_uid: txUid ? String(txUid) : null,
            tx_id: txId ? String(txId) : null,
            uid_kind_guess: uidKind,
          });
        }

        // === CURRENCY VALIDATION (STOP if not BYN) ===
        const txCurrency = String(tx.currency ?? tx.currency_code ?? tx.currencyCode ?? 'BYN').toUpperCase();
        if (txCurrency !== 'BYN') {
          result.errors++;
          result.error_details.push({
            payment_id: payment.id,
            error: `Currency mismatch: expected BYN, got ${txCurrency}. STOP - manual review required.`,
          });
          continue;
        }

        // === AMOUNT NORMALIZATION (minor units → major units) ===
        // bePaid stores in kopecks: 10000 = 100.00 BYN, 15000 = 150.00 BYN
        const rawBepaidAmount = tx.amount ?? 0;
        let bepaidAmount = rawBepaidAmount / 100;

        // Refunds should be negative in our system
        const isRefund =
          tx.type === 'refund' ||
          (payment.transaction_type && String(payment.transaction_type).toLowerCase().includes('refund')) ||
          (payment.transaction_type && String(payment.transaction_type).toLowerCase().includes('возврат'));

        if (isRefund && bepaidAmount > 0) {
          bepaidAmount = -bepaidAmount;
        }

        const ourAmount = Number(payment.amount);
        const diff = Math.abs(ourAmount - bepaidAmount);

        // === STOP GUARD: Delta > 1000 BYN threshold ===
        const MAX_DELTA_BYN = 1000;
        if (diff > MAX_DELTA_BYN) {
          result.errors++;
          result.error_details.push({
            payment_id: payment.id,
            error: `Delta exceeds safety threshold: ${diff.toFixed(2)} BYN (max: ${MAX_DELTA_BYN}). STOP - manual review required.`,
          });
          continue;
        }

        if (diff > 0.01) {
          const discrepancy: Discrepancy = {
            payment_id: payment.id,
            provider_payment_id: uid,
            order_id: payment.order_id,
            our_amount: ourAmount,
            bepaid_amount: bepaidAmount,
            transaction_type: payment.transaction_type || tx.type || 'unknown',
            status: payment.status || tx.status || 'unknown',
            paid_at: payment.paid_at,
            customer_email: tx.customer?.email || null,
            bepaid_http_status: fetched.status,
            bepaid_endpoint: fetched.endpoint,
          };

          result.discrepancies.push(discrepancy);
          result.discrepancies_found++;

          if (!dry_run) {
            const { error: updateError } = await supabase
              .from('payments_v2')
              .update({
                amount: bepaidAmount,
                meta: {
                  ...(payment.meta || {}),
                  original_amount: ourAmount,
                  amount_corrected_at: new Date().toISOString(),
                  amount_corrected_source: 'bepaid_api_reconcile_2026',
                  bepaid_raw_amount: tx.amount,
                  bepaid_transaction_type: tx.type,
                },
              })
              .eq('id', payment.id);

            if (updateError) {
              throw new Error(`Failed to update payment: ${updateError.message}`);
            }

            // SYSTEM ACTOR audit log (as per spec)
            await supabase.from('audit_logs').insert({
              actor_user_id: null, // system action
              actor_type: 'system',
              actor_label: 'bepaid_reconcile_2026',
              action: 'bepaid_reconcile_amounts',
              target_user_id: payment.profile_id,
              meta: {
                payment_id: payment.id,
                provider_payment_id: uid,
                order_id: payment.order_id,
                old_amount: ourAmount,
                new_amount: bepaidAmount,
                delta: bepaidAmount - ourAmount,
                raw_bepaid_amount: rawBepaidAmount,
                currency: txCurrency,
                matched_shape: fetched.matched_shape,
                source: 'bepaid_api_reconcile_2026',
                initiated_by_user_id: user.id,
              },
            });

            result.fixed++;
          }
        }

        // Reduced throttle for faster execution (bePaid allows higher rate)
        if (max_payments_to_check > 50) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      } catch (error) {
        console.error(`[Reconcile] Error processing payment ${payment.id}:`, error);
        result.errors++;
        result.error_details.push({
          payment_id: payment.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log(
      `[Reconcile] Complete: checked=${result.checked}, discrepancies=${result.discrepancies_found}, fixed=${result.fixed}, skipped=${result.skipped}, not_found=${result.not_found}, errors=${result.errors}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        dry_run,
        ...result,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Reconcile] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
