import { createClient } from "npm:@supabase/supabase-js@2";
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ReconcileMode = 'list' | 'uid_verify' | 'auto';

interface ReconcileRequest {
  from_date?: string;
  to_date?: string;
  dry_run?: boolean;
  limit?: number;
  mode?: ReconcileMode;
}

interface UidVerifyStats {
  checked_uids: number;
  verified_ok: number;
  unverifiable: number;
  updated_amount: number;
  updated_status: number;
  updated_paid_at: number;
  updated_card_fields: number;
  refunds_card_filled: number;
  errors: number;
}

function normalizeStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'successful': case 'success': return 'succeeded';
    case 'failed': case 'declined': case 'expired': case 'error': return 'failed';
    case 'incomplete': case 'processing': return 'processing';
    case 'pending': return 'pending';
    case 'refunded': case 'voided': return 'refunded';
    case 'canceled': case 'cancelled': return 'canceled';
    default: return 'pending';
  }
}

function normalizeCardBrand(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const lower = brand.toLowerCase().trim();
  const brandMap: Record<string, string> = { 'master': 'mastercard', 'mc': 'mastercard', 'mastercard': 'mastercard', 'visa': 'visa', 'belkart': 'belkart', 'belcard': 'belkart', 'maestro': 'maestro', 'mir': 'mir' };
  return brandMap[lower] || lower;
}

function normalizeLast4(last4: string | null | undefined): string | null {
  if (!last4) return null;
  const cleaned = last4.replace(/\D/g, '').slice(-4);
  return cleaned.length === 4 ? cleaned : null;
}

// LIST MODE: Fetch with 8-endpoint probing
async function fetchFromBepaidWithProbing(auth: string, shopId: string, fromDate: Date, toDate: Date, maxTransactions: number, startTime: number): Promise<{ success: boolean; transactions: any[]; error?: string; pages: number; endpoint_used?: string }> {
  const fromDateISO = fromDate.toISOString();
  const toDateISO = toDate.toISOString();
  
  const buildUrl = (base: string, includeShopId: boolean, page = 1) => {
    const params = new URLSearchParams({ created_at_from: fromDateISO, created_at_to: toDateISO, per_page: "100", page: String(page), ...(includeShopId ? { shop_id: String(shopId) } : {}) });
    return `${base}?${params.toString()}`;
  };

  const candidates = [
    { name: "gateway:/transactions", base: "https://gateway.bepaid.by/transactions", includeShopId: false },
    { name: "gateway:/transactions?shop_id", base: "https://gateway.bepaid.by/transactions", includeShopId: true },
    { name: "gateway:/api/v1/transactions", base: "https://gateway.bepaid.by/api/v1/transactions", includeShopId: false },
    { name: "api:/transactions", base: "https://api.bepaid.by/transactions", includeShopId: false },
    { name: "api:/transactions?shop_id", base: "https://api.bepaid.by/transactions", includeShopId: true },
    { name: "api:/reports/transactions", base: "https://api.bepaid.by/reports/transactions", includeShopId: false },
    { name: "gateway:/reports/transactions", base: "https://gateway.bepaid.by/reports/transactions", includeShopId: false },
    { name: "checkout:/transactions", base: "https://checkout.bepaid.by/transactions", includeShopId: false },
  ];

  const errors: string[] = [];
  
  for (const candidate of candidates) {
    if (Date.now() - startTime > 25000) break;
    
    try {
      const url = buildUrl(candidate.base, candidate.includeShopId);
      console.log(`[full-reconcile] Trying: ${candidate.name}`);
      
      const response = await fetch(url, { method: "GET", headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", "Accept": "application/json" } });
      
      if (!response.ok) { errors.push(`${candidate.name}: ${response.status}`); continue; }
      
      const data = await response.json();
      const transactions = data.transactions || data.data || [];
      
      if (!Array.isArray(transactions) || transactions.length === 0) { errors.push(`${candidate.name}: 0 transactions`); continue; }
      
      console.log(`[full-reconcile] Success: ${candidate.name} returned ${transactions.length}`);
      
      let allTransactions = [...transactions];
      let page = 2, pages = 1;
      
      while (allTransactions.length < maxTransactions && transactions.length === 100) {
        const nextResp = await fetch(buildUrl(candidate.base, candidate.includeShopId, page), { method: "GET", headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" } });
        if (!nextResp.ok) break;
        const nextData = await nextResp.json();
        const nextTx = nextData.transactions || nextData.data || [];
        if (!Array.isArray(nextTx) || nextTx.length === 0) break;
        allTransactions = [...allTransactions, ...nextTx];
        pages++; page++;
        if (nextTx.length < 100) break;
      }
      
      return { success: true, transactions: allTransactions.slice(0, maxTransactions), pages, endpoint_used: candidate.name };
    } catch (err) { errors.push(`${candidate.name}: ${(err as Error).message}`); }
  }
  
  return { success: false, transactions: [], error: `All bePaid endpoints failed: ${errors.join('; ')}`, pages: 0 };
}

// UID VERIFY: Fetch single transaction
async function fetchTransactionDetails(auth: string, uid: string): Promise<{ success: boolean; data?: any }> {
  const endpoints = [`https://gateway.bepaid.by/transactions/${uid}`, `https://api.bepaid.by/transactions/${uid}`, `https://checkout.bepaid.by/transactions/${uid}`];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "GET", headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", "Accept": "application/json" } });
      if (response.status === 404 || response.status === 403) continue;
      if (!response.ok) continue;
      const data = await response.json();
      const tx = data.transaction || data;
      if (tx && (tx.uid || tx.id)) return { success: true, data: tx };
    } catch (err) { /* continue */ }
  }
  return { success: false };
}

// UID VERIFY MODE
async function runUidVerifyMode(supabase: any, auth: string, fromDate: string, toDate: string, dryRun: boolean, limit: number, startTime: number): Promise<{ success: boolean; stats: UidVerifyStats; samples: any; error?: string }> {
  const stats: UidVerifyStats = { checked_uids: 0, verified_ok: 0, unverifiable: 0, updated_amount: 0, updated_status: 0, updated_paid_at: 0, updated_card_fields: 0, refunds_card_filled: 0, errors: 0 };
  const samples = { verified: [] as any[], unverifiable: [] as any[], errors: [] as any[] };
  const maxSamples = 20;

  const { data: payments, error: fetchError } = await supabase.from('payments_v2').select('id, provider_payment_id, amount, status, paid_at, card_last4, card_brand, transaction_type, meta').gte('paid_at', fromDate).lte('paid_at', toDate + 'T23:59:59Z').not('provider_payment_id', 'is', null).order('paid_at', { ascending: false }).limit(limit);
  
  if (fetchError) return { success: false, stats, samples, error: `DB error: ${fetchError.message}` };
  if (!payments || payments.length === 0) return { success: true, stats, samples };
  
  console.log(`[uid-verify] Found ${payments.length} UIDs to verify`);
  
  for (const payment of payments) {
    if (Date.now() - startTime > 25000) break;
    stats.checked_uids++;
    const uid = payment.provider_payment_id;
    
    try {
      const txResult = await fetchTransactionDetails(auth, uid);
      
      if (!txResult.success || !txResult.data) {
        stats.unverifiable++;
        if (!dryRun) {
          await supabase.from('payments_v2').update({ meta: { ...(payment.meta || {}), reconcile_verification: { status: 'unverifiable', reason: 'bepaid_details_denied', at: new Date().toISOString(), uid } } }).eq('id', payment.id);
        }
        if (samples.unverifiable.length < maxSamples) samples.unverifiable.push({ uid, reason: 'bepaid_details_denied' });
        continue;
      }
      
      const tx = txResult.data;
      const changes: string[] = [];
      const updates: Record<string, any> = {};
      
      const bepaidAmount = (tx.amount || 0) / 100;
      if (Math.abs(bepaidAmount - payment.amount) >= 0.01) { changes.push(`amount: ${payment.amount} → ${bepaidAmount}`); updates.amount = bepaidAmount; stats.updated_amount++; }
      
      const bepaidStatus = normalizeStatus(tx.status);
      if (bepaidStatus && bepaidStatus !== payment.status) { changes.push(`status: ${payment.status} → ${bepaidStatus}`); updates.status = bepaidStatus; stats.updated_status++; }
      
      const bepaidCardLast4 = normalizeLast4(tx.credit_card?.last_4 || tx.card?.last_4);
      const bepaidCardBrand = normalizeCardBrand(tx.credit_card?.brand || tx.card?.brand);
      
      if (bepaidCardLast4 && !payment.card_last4) { changes.push(`card_last4: null → ${bepaidCardLast4}`); updates.card_last4 = bepaidCardLast4; stats.updated_card_fields++; }
      if (bepaidCardBrand && !payment.card_brand) { changes.push(`card_brand: null → ${bepaidCardBrand}`); updates.card_brand = bepaidCardBrand; }
      
      if (changes.length > 0) {
        updates.meta = { ...(payment.meta || {}), reconcile_verification: { status: 'verified', at: new Date().toISOString(), uid, changes } };
        if (!dryRun) await supabase.from('payments_v2').update(updates).eq('id', payment.id);
        if (samples.verified.length < maxSamples) samples.verified.push({ uid, changes });
      } else {
        stats.verified_ok++;
      }
    } catch (err) { stats.errors++; if (samples.errors.length < maxSamples) samples.errors.push({ uid, error: (err as Error).message }); }
  }
  
  return { success: true, stats, samples };
}

// LIST MODE: Process transactions
async function processListModeTransactions(supabase: any, transactions: any[], dryRun: boolean): Promise<{ counters: any; samples: any }> {
  const counters = { bepaid_total: transactions.length, already_in_db: 0, missing_in_db: 0, mismatched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const samples = { inserts: [] as any[], updates: [] as any[], mismatches: [] as any[] };
  const maxSamples = 20;
  
  const uids = transactions.map(tx => tx.uid || tx.id).filter(Boolean);
  const { data: existingPayments } = await supabase.from('payments_v2').select('id, provider_payment_id, amount, status, card_last4, card_brand, meta').in('provider_payment_id', uids);
  const existingMap = new Map<string, { id: string; provider_payment_id: string; amount: number; status: string; card_last4: string | null; card_brand: string | null; meta: any }>((existingPayments || []).map((p: any) => [p.provider_payment_id, p]));
  
  for (const tx of transactions) {
    const uid = tx.uid || tx.id;
    if (!uid) { counters.skipped++; continue; }
    
    const existing = existingMap.get(uid);
    const bepaidAmount = (tx.amount || 0) / 100;
    const bepaidStatus = normalizeStatus(tx.status);
    const last4 = normalizeLast4(tx.credit_card?.last_4 || tx.card?.last_4);
    const brand = normalizeCardBrand(tx.credit_card?.brand || tx.card?.brand);
    
    if (existing) {
      counters.already_in_db++;
      const changes: string[] = [];
      const updates: Record<string, any> = {};
      
      if (Math.abs(bepaidAmount - existing.amount) >= 0.01) { changes.push(`amount: ${existing.amount} → ${bepaidAmount}`); updates.amount = bepaidAmount; }
      if (bepaidStatus && bepaidStatus !== existing.status) { changes.push(`status: ${existing.status} → ${bepaidStatus}`); updates.status = bepaidStatus; }
      if (last4 && !existing.card_last4) { changes.push(`card_last4: null → ${last4}`); updates.card_last4 = last4; }
      if (brand && !existing.card_brand) { changes.push(`card_brand: null → ${brand}`); updates.card_brand = brand; }
      
      if (changes.length > 0) {
        counters.mismatched++;
        if (!dryRun) { await supabase.from('payments_v2').update(updates).eq('id', existing.id); }
        counters.updated++;
        if (samples.mismatches.length < maxSamples) samples.mismatches.push({ uid, changes });
      }
    } else {
      counters.missing_in_db++;
      const newPayment = { provider_payment_id: uid, amount: bepaidAmount, currency: tx.currency || 'BYN', status: bepaidStatus, card_last4: last4, card_brand: brand, paid_at: tx.paid_at || tx.created_at, customer_email: tx.customer?.email, provider_response: tx, meta: { source: 'bepaid_full_reconcile', imported_at: new Date().toISOString() } };
      if (!dryRun) { await supabase.from('payments_v2').insert(newPayment); }
      counters.inserted++;
      if (samples.inserts.length < maxSamples) samples.inserts.push({ uid, amount: bepaidAmount, status: bepaidStatus });
    }
  }
  
  return { counters, samples };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ ok: false, error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
      supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }),
    ]);
    if (!hasAdmin && !hasSuperAdmin) return new Response(JSON.stringify({ ok: false, error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body: ReconcileRequest = await req.json().catch(() => ({}));
    const from_date = body.from_date || '2026-01-01';
    const to_date = body.to_date || new Date().toISOString().split('T')[0];
    const dry_run = body.dry_run !== false;
    const limit = Math.min(body.limit || 500, 2000);
    const requestedMode = body.mode || 'auto';

    console.log(`[full-reconcile] mode=${requestedMode}, from=${from_date}, to=${to_date}, dry_run=${dry_run}`);

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ ok: false, error: "bePaid credentials missing: " + credsResult.error }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const bepaidCreds = credsResult;
    const shopId = bepaidCreds.shop_id;
    const auth = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');
    const fromDate = new Date(`${from_date}T00:00:00Z`);
    const toDate = new Date(`${to_date}T23:59:59Z`);

    let modeUsed: 'list' | 'uid_verify' = 'list';
    let fallbackReason: string | undefined;
    let listResult: any = null;

    if (requestedMode === 'list' || requestedMode === 'auto') {
      listResult = await fetchFromBepaidWithProbing(auth, shopId, fromDate, toDate, limit, startTime);
      
      if (listResult.success && listResult.transactions.length > 0) {
        modeUsed = 'list';
      } else if (requestedMode === 'auto') {
        modeUsed = 'uid_verify';
        fallbackReason = listResult.error || 'List returned 0 transactions';
        console.log(`[full-reconcile] Fallback to UID_VERIFY: ${fallbackReason}`);
      } else {
        return new Response(JSON.stringify({ ok: false, error: listResult.error || 'List mode failed', mode_attempted: 'list' }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      modeUsed = 'uid_verify';
    }

    let response: any;

    if (modeUsed === 'list' && listResult?.success) {
      const { counters, samples } = await processListModeTransactions(supabase, listResult.transactions, dry_run);
      response = { ok: true, dry_run, mode_used: 'list', endpoint_used: listResult.endpoint_used, period: { from_date, to_date }, fetched: { bepaid_total: counters.bepaid_total, pages: listResult.pages }, db: { already_in_db: counters.already_in_db, missing_in_db: counters.missing_in_db, mismatched: counters.mismatched }, actions: { inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped, errors: counters.errors }, samples, runtime_ms: Date.now() - startTime };
    } else {
      const uidResult = await runUidVerifyMode(supabase, auth, from_date, to_date, dry_run, limit, startTime);
      if (!uidResult.success) return new Response(JSON.stringify({ ok: false, error: uidResult.error || 'UID verify failed', mode_attempted: 'uid_verify', partial_stats: uidResult.stats }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      response = { ok: true, dry_run, mode_used: 'uid_verify', fallback_reason: fallbackReason, period: { from_date, to_date }, uid_verify_stats: uidResult.stats, samples: { verified: uidResult.samples.verified, unverifiable: uidResult.samples.unverifiable, errors: uidResult.samples.errors }, runtime_ms: Date.now() - startTime };
    }

    if (!dry_run) {
      await supabase.from('audit_logs').insert({ actor_type: 'system', actor_user_id: null, actor_label: 'admin-bepaid-full-reconcile', action: 'bepaid_full_reconcile', meta: { triggered_by: user.id, mode_used: modeUsed, fallback_reason: fallbackReason, period: { from_date, to_date }, dry_run: false, ...(modeUsed === 'list' ? { fetched: response.fetched, db: response.db, actions: response.actions } : { uid_verify_stats: response.uid_verify_stats }), runtime_ms: response.runtime_ms } });
    }

    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[full-reconcile] Error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message || "Internal error", runtime_ms: Date.now() - startTime }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
