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
  limit?: number;
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
  not_found?: number;
  stopped_reason: string | null;
  error_samples: Array<{ uid: string; error: string }>;
  amount_sum_db: number;
  amount_sum_api: number;
  diff_count: number;
  diff_amount: number;
  endpoint_used?: string;
  endpoint_attempts?: any[];
  selected_host?: string;
  strategy_used?: 'list' | 'uid_fallback';
  not_found_rate?: number;
  sample_uids?: string[];
  uid_probe_attempts?: Array<{ host: string; uid: string; status: number | null; ok: boolean; error: string | null }>;
  dry_run?: boolean;
  auth_mode?: string;
  pages_fetched?: number;
  api_total_count?: number;
}

interface EndpointAttempt {
  name: string;
  url: string;
  status: number | null;
  ok: boolean;
  keys_found: string[] | null;
  error: string | null;
  tx_count?: number;
}

// ============ CONSTANTS ============
const MAX_CONSECUTIVE_ERRORS = 50;
const MAX_DELTA_PER_TX_BYN = 1000;
const MAX_TRANSACTIONS = 10000;
const MAX_ERROR_SAMPLES = 20;

const BEPAID_HOSTS_FOR_UID = [
  'https://merchant.bepaid.by',
  'https://api.bepaid.by',
  'https://gateway.bepaid.by',
] as const;

function truncateText(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

async function readErrorBody(resp: Response): Promise<string> {
  try {
    const t = await resp.text();
    return truncateText(t || 'no body');
  } catch {
    return 'no body';
  }
}

async function fetchBeyagTransactionByUid(
  host: string,
  auth: string,
  uid: string
): Promise<{ ok: boolean; status: number; data?: any; errorBody?: string }>{
  const url = `${host}/beyag/transactions/${encodeURIComponent(uid)}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'X-API-Version': '3',
    },
  });

  if (!resp.ok) {
    return { ok: false, status: resp.status, errorBody: await readErrorBody(resp) };
  }

  const data = await resp.json();
  return { ok: true, status: resp.status, data };
}

async function pickWorkingBeyagHost(
  auth: string,
  sampleUids: string[],
  startTime: number
): Promise<{ selected_host: string | null; attempts: SyncStats['uid_probe_attempts'] }>{
  const attempts: NonNullable<SyncStats['uid_probe_attempts']> = [];

  if (!sampleUids.length) {
    return { selected_host: BEPAID_HOSTS_FOR_UID[0], attempts };
  }

  for (const host of BEPAID_HOSTS_FOR_UID) {
    for (const uid of sampleUids) {
      if (Date.now() - startTime > 25000) break;

      try {
        const res = await fetchBeyagTransactionByUid(host, auth, uid);
        attempts.push({
          host,
          uid,
          status: res.status,
          ok: res.ok,
          error: res.ok ? null : `HTTP ${res.status}: ${res.errorBody || 'no body'}`,
        });
        if (res.ok) {
          return { selected_host: host, attempts };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ host, uid, status: null, ok: false, error: msg });
      }
    }
  }

  return { selected_host: null, attempts };
}

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
  if (b.includes('belcard') || b.includes('белкарт') || b.includes('belkart')) return 'belkart';
  if (b.includes('mir') || b.includes('мир')) return 'mir';
  if (b.includes('maestro')) return 'maestro';
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
      return { tx: null, error: `STOP: Currency field missing for UID ${uid}` };
    }
    const normalizedCurrency = String(currency).toUpperCase();
    if (normalizedCurrency !== 'BYN') {
      return { tx: null, error: `STOP: Currency mismatch - expected BYN, got ${normalizedCurrency} for UID ${uid}` };
    }

    // 4) paid_at REQUIRED — NO DEFAULT to now()
    const paidAt = raw.paid_at || raw.finished_at || raw.created_at;
    if (!paidAt) {
      return { tx: null, error: `Missing paid_at for UID ${uid}` };
    }

    // 5) Transaction type
    const txType = determineTransactionType(raw);
    const signedAmount = txType === 'refund' ? -Math.abs(normalizedAmount) : Math.abs(normalizedAmount);

    // 6) Extract card info
    const cc = raw.credit_card || raw.card || {};
    
    // 7) Extract customer info
    const customer = raw.customer || {};
    const additional = raw.additional_data || {};

    // 8) Extract product info
    const product = raw.product || additional.product || {};

    return {
      tx: {
        uid: String(uid),
        amount: signedAmount,
        raw_amount: rawAmount,
        currency: 'BYN',
        transaction_type: txType,
        status: normalizeStatus(raw.status),
        paid_at: paidAt,
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

// ============ 8-ENDPOINT PROBING (API LIST → DB strategy) ============

async function fetchFromBepaidWithProbing(
  auth: string,
  shopId: string,
  fromDate: Date,
  toDate: Date,
  maxTransactions: number,
  startTime: number
): Promise<{
  success: boolean;
  transactions: any[];
  error?: string;
  pages: number;
  endpoint_used?: string;
  endpoint_attempts: EndpointAttempt[];
}> {
  const fromDateISO = fromDate.toISOString();
  const toDateISO = toDate.toISOString();

  const buildUrl = (base: string, includeShopId: boolean, page = 1) => {
    const params = new URLSearchParams({
      created_at_from: fromDateISO,
      created_at_to: toDateISO,
      per_page: "100",
      page: String(page),
      ...(includeShopId ? { shop_id: String(shopId) } : {}),
    });
    return `${base}?${params.toString()}`;
  };

  // Extended candidate endpoints to try (including /api/v1/ paths and beyag)
  const candidates = [
    // merchant host MUST be included in probes
    { name: "merchant:/v2/transactions", base: "https://merchant.bepaid.by/v2/transactions", includeShopId: false },
    { name: "merchant:/v2/transactions?shop_id", base: "https://merchant.bepaid.by/v2/transactions", includeShopId: true },
    { name: "merchant:/transactions", base: "https://merchant.bepaid.by/transactions", includeShopId: false },
    { name: "merchant:/transactions?shop_id", base: "https://merchant.bepaid.by/transactions", includeShopId: true },
    { name: "merchant:/api/v1/transactions", base: "https://merchant.bepaid.by/api/v1/transactions", includeShopId: false },
    { name: "merchant:/api/v1/transactions?shop_id", base: "https://merchant.bepaid.by/api/v1/transactions", includeShopId: true },

    // v2 endpoints (we know single-transaction endpoints exist under /v2/transactions)
    { name: "gateway:/v2/transactions", base: "https://gateway.bepaid.by/v2/transactions", includeShopId: false },
    { name: "gateway:/v2/transactions?shop_id", base: "https://gateway.bepaid.by/v2/transactions", includeShopId: true },
    { name: "api:/v2/transactions", base: "https://api.bepaid.by/v2/transactions", includeShopId: false },
    { name: "api:/v2/transactions?shop_id", base: "https://api.bepaid.by/v2/transactions", includeShopId: true },
    { name: "gateway:/transactions", base: "https://gateway.bepaid.by/transactions", includeShopId: false },
    { name: "gateway:/transactions?shop_id", base: "https://gateway.bepaid.by/transactions", includeShopId: true },
    { name: "gateway:/api/v1/transactions", base: "https://gateway.bepaid.by/api/v1/transactions", includeShopId: false },
    { name: "gateway:/api/v1/transactions?shop_id", base: "https://gateway.bepaid.by/api/v1/transactions", includeShopId: true },
    { name: "api:/transactions", base: "https://api.bepaid.by/transactions", includeShopId: false },
    { name: "api:/transactions?shop_id", base: "https://api.bepaid.by/transactions", includeShopId: true },
    { name: "api:/api/v1/transactions", base: "https://api.bepaid.by/api/v1/transactions", includeShopId: false },
    { name: "api:/reports/transactions", base: "https://api.bepaid.by/reports/transactions", includeShopId: false },
    { name: "gateway:/reports/transactions", base: "https://gateway.bepaid.by/reports/transactions", includeShopId: false },
    { name: "checkout:/transactions", base: "https://checkout.bepaid.by/transactions", includeShopId: false },
    { name: "api:/beyag/transactions", base: "https://api.bepaid.by/beyag/transactions", includeShopId: false },
  ];

  const endpointAttempts: EndpointAttempt[] = [];

  const tryReportsApi = async (): Promise<{ success: boolean; transactions: any[]; endpoint_used?: string; error?: string } > => {
    // Reports API endpoints seen working in other backend functions.
    const reportEndpoints = [
      { name: 'reports:merchant:/api/reports', url: 'https://merchant.bepaid.by/api/reports' },
      { name: 'reports:api:/api/reports', url: 'https://api.bepaid.by/api/reports' },
      { name: 'reports:gateway:/api/reports', url: 'https://gateway.bepaid.by/api/reports' },
      { name: 'reports:merchant:/reports', url: 'https://merchant.bepaid.by/reports' },
      { name: 'reports:api:/reports', url: 'https://api.bepaid.by/reports' },
      { name: 'reports:gateway:/reports', url: 'https://gateway.bepaid.by/reports' },
    ];

    const formatDate = (d: Date) => d.toISOString().replace('T', ' ').substring(0, 19);

    const requestBody = {
      report_params: {
        date_type: 'created_at',
        from: formatDate(fromDate),
        to: formatDate(toDate),
        status: 'all',
        payment_method_type: 'all',
        time_zone: 'Europe/Minsk',
      },
    };

    for (const ep of reportEndpoints) {
      if (Date.now() - startTime > 25000) break;

      try {
        console.log(`[Sync] Trying Reports API: ${ep.name}`);

        const response = await fetch(ep.url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            // Reports API in our codebase uses v2.
            'X-API-Version': '2',
          },
          body: JSON.stringify(requestBody),
        });

        const attempt: EndpointAttempt = {
          name: ep.name,
          url: ep.url,
          status: response.status,
          ok: response.ok,
          keys_found: null,
          error: null,
        };

        if (!response.ok) {
         attempt.error = `HTTP ${response.status}: ${await readErrorBody(response)}`;
          console.log(`[Sync] ${ep.name} failed: ${attempt.error}`);
          endpointAttempts.push(attempt);
          continue;
        }

        const data = await response.json();
        const transactions = data.transactions || data.data?.transactions || data.items || data.data || [];
        attempt.keys_found = data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : null;
        attempt.tx_count = Array.isArray(transactions) ? transactions.length : undefined;

        if (!Array.isArray(transactions) || transactions.length === 0) {
          attempt.error = '0 transactions returned';
          endpointAttempts.push(attempt);
          continue;
        }

        const firstTx = transactions[0];
        if (!firstTx?.uid && !firstTx?.id) {
          attempt.error = 'No uid/id in transactions';
          endpointAttempts.push(attempt);
          continue;
        }

        endpointAttempts.push(attempt);
        console.log(`[Sync] Success! ${ep.name} returned ${transactions.length} transactions`);
        return { success: true, transactions: transactions.slice(0, maxTransactions), endpoint_used: ep.name };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        endpointAttempts.push({
          name: ep.name,
          url: ep.url,
          status: null,
          ok: false,
          keys_found: null,
          error: errMsg,
        });
      }
    }

    return { success: false, transactions: [], error: 'All Reports API endpoints failed' };
  };

  for (const candidate of candidates) {
    // Timeout check
    if (Date.now() - startTime > 25000) {
      break;
    }

    const url = buildUrl(candidate.base, candidate.includeShopId);
    
    try {
      console.log(`[Sync] Trying endpoint: ${candidate.name}`);
      
      // CRITICAL: Include API version header (some routes require it)
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
          "X-API-Version": "3",
        },
      });

      const attempt: EndpointAttempt = {
        name: candidate.name,
        url: url.replace(/shop_id=\d+/, 'shop_id=***'),
        status: response.status,
        ok: response.ok,
        keys_found: null,
        error: null,
      };

      if (!response.ok) {
        // Try to get error body for debugging
         attempt.error = `HTTP ${response.status}: ${await readErrorBody(response)}`;
        console.log(`[Sync] ${candidate.name} failed: ${attempt.error}`);
        endpointAttempts.push(attempt);
        continue;
      }

      const data = await response.json();
      const transactions = data.transactions || data.data || [];
      
      attempt.keys_found = Object.keys(data).slice(0, 5);
      attempt.tx_count = transactions.length;

      if (!Array.isArray(transactions)) {
        attempt.error = 'Response is not an array';
        endpointAttempts.push(attempt);
        continue;
      }

      if (transactions.length === 0) {
        attempt.error = '0 transactions returned';
        endpointAttempts.push(attempt);
        continue;
      }

      // Validate first transaction has required fields
      const firstTx = transactions[0];
      if (!firstTx.uid && !firstTx.id) {
        attempt.error = 'No uid/id in transactions';
        endpointAttempts.push(attempt);
        continue;
      }

      console.log(`[Sync] Success! ${candidate.name} returned ${transactions.length} transactions`);
      endpointAttempts.push(attempt);

      // Paginate to get all transactions
      let allTransactions = [...transactions];
      let page = 2;
      let pages = 1;

      while (allTransactions.length < maxTransactions && transactions.length === 100) {
        if (Date.now() - startTime > 25000) break;

        const nextUrl = buildUrl(candidate.base, candidate.includeShopId, page);
        const nextResp = await fetch(nextUrl, {
          method: "GET",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Accept": "application/json",
            "X-API-Version": "3",
          },
        });

        if (!nextResp.ok) break;

        const nextData = await nextResp.json();
        const nextTx = nextData.transactions || nextData.data || [];

        if (!Array.isArray(nextTx) || nextTx.length === 0) break;

        allTransactions = [...allTransactions, ...nextTx];
        pages++;
        page++;

        console.log(`[Sync] Fetched page ${pages}, total: ${allTransactions.length}`);

        if (nextTx.length < 100) break;
      }

      return {
        success: true,
        transactions: allTransactions.slice(0, maxTransactions),
        pages,
        endpoint_used: candidate.name,
        endpoint_attempts: endpointAttempts,
      };

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      endpointAttempts.push({
        name: candidate.name,
        url: url.replace(/shop_id=\d+/, 'shop_id=***'),
        status: null,
        ok: false,
        keys_found: null,
        error: errMsg,
      });
    }
  }

  // Fallback: Reports API (POST) – for accounts where /transactions list routes don't exist.
  const reportsResult = await tryReportsApi();
  if (reportsResult.success) {
    return {
      success: true,
      transactions: reportsResult.transactions,
      pages: 1,
      endpoint_used: reportsResult.endpoint_used,
      endpoint_attempts: endpointAttempts,
    };
  }

  // All endpoints failed
  const errorSummary = endpointAttempts.map(e => `${e.name}: ${e.error}`).join('; ');
  return {
    success: false,
    transactions: [],
    error: `All bePaid endpoints failed: ${errorSummary}`,
    pages: 0,
    endpoint_attempts: endpointAttempts,
  };
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
      limit = MAX_TRANSACTIONS,
    } = body;

    if (!from_date || !to_date) {
      return new Response(JSON.stringify({ error: "from_date and to_date required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Sync] Starting API→DB sync for ${from_date} to ${to_date}, dry_run=${dry_run}, limit=${limit}`);

    // === GET BEPAID CREDENTIALS ===
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
    const authMode = `basic ${String(shopId).slice(0, 4)}***:***`;

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
        stats: { dry_run, auth_mode: authMode },
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
       not_found: 0,
      stopped_reason: null,
      error_samples: [],
      amount_sum_db: 0,
      amount_sum_api: 0,
      diff_count: 0,
      diff_amount: 0,
      auth_mode: authMode,
    };

    let consecutiveErrors = 0;
    let stopped = false;

    try {
      // ========== STEP 0: AUTO-PROBE HOST FOR UID FETCH (3 samples) ==========
      const { data: sampleRows } = await supabase
        .from('payments_v2')
        .select('provider_payment_id')
        .eq('provider', 'bepaid')
        .not('provider_payment_id', 'is', null)
        .order('paid_at', { ascending: false })
        .limit(3);

      const sampleUids = (sampleRows || [])
        .map((r: any) => r.provider_payment_id)
        .filter(Boolean)
        .map(String);

      stats.sample_uids = sampleUids;

      const hostProbe = await pickWorkingBeyagHost(auth, sampleUids, startTime);
      stats.selected_host = hostProbe.selected_host || 'https://merchant.bepaid.by';
      stats.uid_probe_attempts = hostProbe.attempts;

      await supabase
        .from('payments_sync_runs')
        .update({
          stats: { ...stats, phase: 'host_probed' },
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      // ========== STEP 1: TRY LIST → DB (only if LIST returns >= 1 transaction) ==========
      const fromDate = new Date(`${from_date}T00:00:00Z`);
      const toDate = new Date(`${to_date}T23:59:59Z`);

      const listResult = await fetchFromBepaidWithProbing(
        auth,
        shopId,
        fromDate,
        toDate,
        Math.min(limit, MAX_TRANSACTIONS),
        startTime
      );

      stats.endpoint_attempts = listResult.endpoint_attempts;
      stats.endpoint_used = listResult.endpoint_used;
      stats.pages_fetched = listResult.pages;
      stats.api_total_count = listResult.transactions.length;

      // If list returned any transactions, we proceed with list strategy.
      const canUseList = listResult.success && Array.isArray(listResult.transactions) && listResult.transactions.length > 0;

      if (!canUseList) {
        stats.strategy_used = 'uid_fallback';

        // ========== STEP 2 (fallback): DB → API by UID via /beyag/transactions/{uid} ==========
        const startISO = `${from_date}T00:00:00Z`;
        const endISO = `${to_date}T23:59:59Z`;

        // Pull candidate UIDs from DB (paged) within period.
        const uidSet = new Set<string>();
        const existingMap = new Map<string, any>();
        let offset = 0;
        const pageSize = 1000;

        while (uidSet.size < Math.min(limit, MAX_TRANSACTIONS)) {
          const { data: rows, error: rowsErr } = await supabase
            .from('payments_v2')
            .select('id, provider_payment_id, amount, status, transaction_type, paid_at, card_last4, card_brand, meta')
            .eq('provider', 'bepaid')
            .not('provider_payment_id', 'is', null)
            .gte('paid_at', startISO)
            .lte('paid_at', endISO)
            .order('paid_at', { ascending: false })
            .range(offset, offset + pageSize - 1);

          if (rowsErr) {
            throw new Error(rowsErr.message);
          }

          if (!rows || rows.length === 0) break;

          for (const r of rows) {
            const uid = String(r.provider_payment_id);
            if (!uidSet.has(uid)) {
              uidSet.add(uid);
              existingMap.set(uid, r);
              stats.amount_sum_db += Number(r.amount) || 0;
              if (uidSet.size >= Math.min(limit, MAX_TRANSACTIONS)) break;
            }
          }

          offset += pageSize;
          if (rows.length < pageSize) break;
        }

        const uids = Array.from(uidSet);
        const total = uids.length;

        await supabase
          .from('payments_sync_runs')
          .update({
            stats: { ...stats, phase: 'uid_candidates_loaded', uid_candidates: total },
            total_pages: Math.max(1, Math.ceil(total / 100)),
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId);

        let notFound = 0;
        const host = stats.selected_host || 'https://merchant.bepaid.by';

        for (let i = 0; i < uids.length; i++) {
          if (stopped) break;

          const uid = uids[i];
          const existing = existingMap.get(uid);
          if (!existing) continue;

          stats.scanned++;

          // Fetch transaction by UID
          let rawTx: any | null = null;
          try {
            const res = await fetchBeyagTransactionByUid(host, auth, uid);
            if (!res.ok) {
              if (res.status === 404) {
                notFound++;
                // NOT_FOUND ≠ ERROR
              } else {
                consecutiveErrors++;
                stats.errors++;
                if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
                  stats.error_samples.push({ uid, error: `HTTP ${res.status}: ${res.errorBody || 'no body'}` });
                }
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                  stopped = true;
                  stats.stopped_reason = `STOP: ${MAX_CONSECUTIVE_ERRORS} consecutive fetch errors`;
                }
              }
              // update not_found_rate and stop guard
              const processed = i + 1;
              const rate = processed > 0 ? notFound / processed : 0;
              stats.not_found_rate = rate;
              stats.not_found = notFound;
              if (processed >= 20 && rate > 0.10) {
                stopped = true;
                stats.stopped_reason = 'UID exists in bePaid UI but API host mismatch detected';
              }
              continue;
            }

            rawTx = res.data?.transaction || res.data?.data?.transaction || res.data;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            consecutiveErrors++;
            stats.errors++;
            if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
              stats.error_samples.push({ uid, error: msg });
            }
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              stopped = true;
              stats.stopped_reason = `STOP: ${MAX_CONSECUTIVE_ERRORS} consecutive fetch errors`;
            }
            continue;
          }

          consecutiveErrors = 0;

          if (!rawTx) continue;

          // Normalize
          const { tx: normalized, error: normalizeErr } = normalizeTx(rawTx);
          if (normalizeErr) {
            consecutiveErrors++;
            stats.errors++;
            if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
              stats.error_samples.push({ uid, error: normalizeErr });
            }
            if (normalizeErr.includes('STOP')) {
              stopped = true;
              stats.stopped_reason = normalizeErr;
              break;
            }
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              stopped = true;
              stats.stopped_reason = `STOP: ${MAX_CONSECUTIVE_ERRORS} consecutive normalization errors`;
              break;
            }
            continue;
          }

          consecutiveErrors = 0;
          if (!normalized) continue;

          stats.amount_sum_api += normalized.amount;

          // Update only (UID-based path works on existing DB payments)
          const dbAmount = Number(existing.amount);
          const apiAmount = normalized.amount;
          const diff = Math.abs(dbAmount - apiAmount);

          if (diff > MAX_DELTA_PER_TX_BYN) {
            stopped = true;
            stats.stopped_reason = `STOP: Delta ${diff.toFixed(2)} BYN exceeds ${MAX_DELTA_PER_TX_BYN} for UID ${normalized.uid}`;
            break;
          }

          const needsUpdate =
            diff > 0.01 ||
            existing.status !== normalized.status ||
            existing.transaction_type !== normalized.transaction_type ||
            (!existing.card_last4 && normalized.card_last4) ||
            (!existing.card_brand && normalized.card_brand);

          if (!needsUpdate) {
            stats.unchanged++;
          } else {
            if (diff > 0.01) {
              stats.diff_count++;
              stats.diff_amount += (apiAmount - dbAmount);
            }

            if (dry_run) {
              stats.updated++;
            } else {
              const { error: updateError } = await supabase
                .from('payments_v2')
                .update({
                  amount: normalized.amount,
                  status: normalized.status,
                  transaction_type: normalized.transaction_type,
                  paid_at: normalized.paid_at,
                  card_last4: normalized.card_last4 || existing.card_last4,
                  card_brand: normalized.card_brand || existing.card_brand,
                  customer_email: normalized.customer_email || existing.meta?.customer_email,
                  updated_at: new Date().toISOString(),
                  meta: {
                    ...existing.meta,
                    last_synced_at: new Date().toISOString(),
                    sync_run_id: runId,
                    previous_amount: dbAmount,
                    sync_source: 'bepaid_uid',
                    selected_host: host,
                  },
                })
                .eq('id', existing.id);

              if (updateError) {
                stats.errors++;
                if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
                  stats.error_samples.push({ uid: normalized.uid, error: updateError.message });
                }
              } else {
                stats.updated++;
              }
            }
          }

          // progress
          if ((i + 1) % 100 === 0) {
            const progress = total > 0 ? Math.round(((i + 1) / total) * 100) : 0;
            const processedPages = Math.ceil((i + 1) / 100);
            await supabase
              .from('payments_sync_runs')
              .update({
                processed_pages: processedPages,
                stats: { ...stats, progress },
                updated_at: new Date().toISOString(),
              })
              .eq('id', runId);
          }
        }

        // Final not_found_rate guard
        stats.not_found = notFound;
        stats.not_found_rate = total > 0 ? notFound / total : 0;
        if (!stopped && stats.not_found_rate > 0.10) {
          stopped = true;
          stats.stopped_reason = 'UID exists in bePaid UI but API host mismatch detected';
        }

        // UID-based path done → finalize below

      } else {
        stats.strategy_used = 'list';
      }

      // Update run with endpoint info
      await supabase
        .from("payments_sync_runs")
        .update({
          stats: { ...stats, phase: 'fetched_api' },
          total_pages: listResult.pages,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);

      if (stats.strategy_used === 'list') {
        console.log(`[Sync] Fetched ${listResult.transactions.length} transactions from bePaid via ${listResult.endpoint_used}`);

        // ========== STEP 2: FETCH EXISTING PAYMENTS FROM DB ==========
        const uids = listResult.transactions
          .map(tx => tx.uid || tx.id)
          .filter(Boolean)
          .map(String);

        // Batch UIDs to avoid query limits (1000 max per IN clause)
        const batchSize = 500;
        const existingMap = new Map<string, any>();

        for (let i = 0; i < uids.length; i += batchSize) {
          const batchUids = uids.slice(i, i + batchSize);
          const { data: batchPayments } = await supabase
            .from("payments_v2")
            .select("id, provider_payment_id, amount, status, transaction_type, paid_at, card_last4, card_brand, meta")
            .in("provider_payment_id", batchUids);

          if (batchPayments) {
            for (const p of batchPayments) {
              existingMap.set(p.provider_payment_id, p);
              stats.amount_sum_db += Number(p.amount) || 0;
            }
          }
        }

        console.log(`[Sync] Found ${existingMap.size} existing payments in DB`);

        // ========== STEP 3: PROCESS EACH API TRANSACTION → UPSERT ==========
        for (const rawTx of listResult.transactions) {
          if (stopped) break;

          stats.scanned++;

          // Normalize transaction
          const { tx: normalized, error: normalizeErr } = normalizeTx(rawTx);

          if (normalizeErr) {
            consecutiveErrors++;
            stats.errors++;

            if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
              stats.error_samples.push({ uid: rawTx.uid || rawTx.id || 'unknown', error: normalizeErr });
            }

            // STOP on currency mismatch or critical error
            if (normalizeErr.includes('STOP')) {
              stopped = true;
              stats.stopped_reason = normalizeErr;
              break;
            }

            // STOP if too many consecutive errors
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              stopped = true;
              stats.stopped_reason = `STOP: ${MAX_CONSECUTIVE_ERRORS} consecutive normalization errors`;
              break;
            }

            continue;
          }

          consecutiveErrors = 0; // Reset on success

          if (!normalized) continue;

          stats.amount_sum_api += normalized.amount;

          const existing = existingMap.get(normalized.uid);

          if (existing) {
            // ========== UPDATE EXISTING ==========
            const dbAmount = Number(existing.amount);
            const apiAmount = normalized.amount;
            const diff = Math.abs(dbAmount - apiAmount);

            // STOP if delta too large
            if (diff > MAX_DELTA_PER_TX_BYN) {
              stopped = true;
              stats.stopped_reason = `STOP: Delta ${diff.toFixed(2)} BYN exceeds ${MAX_DELTA_PER_TX_BYN} for UID ${normalized.uid}`;
              break;
            }

            // Check if update needed
            const needsUpdate =
              diff > 0.01 ||
              existing.status !== normalized.status ||
              existing.transaction_type !== normalized.transaction_type ||
              (!existing.card_last4 && normalized.card_last4) ||
              (!existing.card_brand && normalized.card_brand);

            if (!needsUpdate) {
              stats.unchanged++;
              continue;
            }

            if (diff > 0.01) {
              stats.diff_count++;
              stats.diff_amount += (apiAmount - dbAmount);
            }

            if (dry_run) {
              stats.updated++;
              continue;
            }

            // Execute update
            const { error: updateError } = await supabase
              .from("payments_v2")
              .update({
                amount: normalized.amount,
                status: normalized.status,
                transaction_type: normalized.transaction_type,
                paid_at: normalized.paid_at,
                card_last4: normalized.card_last4 || existing.card_last4,
                card_brand: normalized.card_brand || existing.card_brand,
                customer_email: normalized.customer_email || existing.meta?.customer_email,
                updated_at: new Date().toISOString(),
                meta: {
                  ...existing.meta,
                  last_synced_at: new Date().toISOString(),
                  sync_run_id: runId,
                  previous_amount: dbAmount,
                  sync_source: 'bepaid_api',
                  selected_host: stats.selected_host,
                },
              })
              .eq("id", existing.id);

            if (updateError) {
              stats.errors++;
              if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
                stats.error_samples.push({ uid: normalized.uid, error: updateError.message });
              }
              continue;
            }

            stats.updated++;

          } else {
            // ========== INSERT NEW ==========
            if (dry_run) {
              stats.inserted++;
              continue;
            }

            const { error: insertError } = await supabase
              .from("payments_v2")
              .insert({
                provider: 'bepaid',
                provider_payment_id: normalized.uid,
                amount: normalized.amount,
                currency: 'BYN',
                status: normalized.status,
                transaction_type: normalized.transaction_type,
                paid_at: normalized.paid_at,
                card_last4: normalized.card_last4,
                card_brand: normalized.card_brand,
                customer_email: normalized.customer_email,
                provider_response: normalized.provider_response,
                meta: {
                  sync_run_id: runId,
                  imported_at: new Date().toISOString(),
                  sync_source: 'bepaid_api',
                  selected_host: stats.selected_host,
                },
              });

            if (insertError) {
              stats.errors++;
              if (stats.error_samples.length < MAX_ERROR_SAMPLES) {
                stats.error_samples.push({ uid: normalized.uid, error: insertError.message });
              }
              continue;
            }

            stats.inserted++;
          }

          // Update progress periodically
          if (stats.scanned % 100 === 0) {
            const progress = Math.round((stats.scanned / listResult.transactions.length) * 100);
            await supabase
              .from("payments_sync_runs")
              .update({
                processed_pages: Math.ceil(stats.scanned / 100),
                stats: { ...stats, progress },
                updated_at: new Date().toISOString(),
              })
              .eq("id", runId);

            console.log(`[Sync] Progress: ${stats.scanned}/${listResult.transactions.length} (${progress}%)`);
          }
        }
      }

      // === FINALIZE ===
      const finalStatus = stopped ? 'stopped' : 'success';
      const duration = Date.now() - startTime;

      stats.dry_run = dry_run;

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
        action: 'bepaid_sync_run',
        meta: {
          run_id: runId,
          mode,
          period: { from_date, to_date },
          dry_run,
          selected_host: stats.selected_host,
          strategy_used: stats.strategy_used,
          not_found_rate: stats.not_found_rate,
          sample_uids: stats.sample_uids,
          stats,
          duration_ms: duration,
          initiated_by: user.id,
          endpoint_used: listResult.endpoint_used,
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

      // Audit proof even on fatal error
      try {
        await supabase.from("audit_logs").insert({
          actor_user_id: null,
          actor_type: 'system',
          actor_label: 'bepaid-sync-orchestrator',
          action: 'bepaid_sync_run',
          meta: {
            run_id: runId,
            mode,
            period: { from_date, to_date },
            dry_run,
            status: 'failed',
            error: message,
            selected_host: stats.selected_host,
            strategy_used: stats.strategy_used,
            not_found_rate: stats.not_found_rate,
            sample_uids: stats.sample_uids,
            stats,
            initiated_by: user.id,
          },
        });
      } catch {
        // ignore audit insert failures
      }

      return new Response(JSON.stringify({
        success: false,
        run_id: runId,
        status: 'failed',
        error: message,
        stats,
      }), {
        status: 200,
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
