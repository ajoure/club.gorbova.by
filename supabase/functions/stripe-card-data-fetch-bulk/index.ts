// ============================================================================
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A
// stripe-card-data-fetch-bulk
//
// Bulk targeted card-data backfill for super_admin.
// Uses the SAME shared enrichment writer as webhook and single-fetch.
//
// Contract:
//   - super_admin only
//   - dry_run=true by default; execute requires dry_run=false explicitly
//   - limit max 200 (recommended 50)
//   - concurrency ≤ 3 (sequential by default for safety)
//   - exact account isolation per call (one account_code)
//   - never creates rows, never touches refund rows, never bePaid
//   - PCI: all writes via shared writer (denylist enforced)
//   - audit: per-PI verdict + one summary; actor = super_admin JWT user_id
//
// Body:
//   {
//     "dry_run": true,
//     "account_code": "stripe_poland",
//     "payment_intents": ["pi_..."] (optional),
//     "limit": 50,
//     "force_refresh": false,
//     "concurrency": 1   // 1..3
//   }
// ============================================================================

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireSuperAdmin } from '../_shared/acquiring/auth-guard.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';
import {
  enrichStripePaymentCardData,
  isCardSnapshotComplete,
  type EnrichmentResult,
} from '../_shared/stripe/card-enrichment.ts';

interface Body {
  dry_run?: boolean;
  account_code?: string;
  payment_intents?: string[];
  limit?: number;
  force_refresh?: boolean;
  concurrency?: number;
}

const PI_REGEX = /^pi_[A-Za-z0-9_]+$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_CONCURRENCY = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface Candidate {
  payment_id: string;
  payment_intent_id: string;
  verdict_pre?: 'ENRICHABLE' | 'ALREADY_COMPLETE';
}

async function pickCandidatesFromDb(
  supabase: any,
  accountCode: string,
  limit: number,
): Promise<Candidate[]> {
  // Positive Stripe payments matching the account, with pi_*. Filter completeness in JS.
  const { data, error } = await supabase
    .from('payments_v2')
    .select('id, provider_payment_id, card_brand, card_last4, meta')
    .eq('provider', 'stripe')
    .gt('amount', 0)
    .like('provider_payment_id', 'pi_%')
    .limit(Math.max(limit * 3, 50));
  if (error) throw new Error(`db_candidate_fetch_failed: ${error.message}`);
  const out: Candidate[] = [];
  for (const row of data ?? []) {
    const rowAccount = (row as any).meta?.stripe?.account_code ?? (row as any).meta?.account_code;
    if (rowAccount && rowAccount !== accountCode) continue;
    if (!PI_REGEX.test((row as any).provider_payment_id)) continue;
    const complete = isCardSnapshotComplete(row as any);
    if (complete) continue;
    out.push({
      payment_id: (row as any).id,
      payment_intent_id: (row as any).provider_payment_id,
      verdict_pre: 'ENRICHABLE',
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function resolveExplicitPi(
  supabase: any,
  pis: string[],
  accountCode: string,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const pi of pis) {
    if (!PI_REGEX.test(pi)) continue;
    const { data: row } = await supabase
      .from('payments_v2')
      .select('id, meta')
      .eq('provider', 'stripe')
      .eq('provider_payment_id', pi)
      .gt('amount', 0)
      .maybeSingle();
    if (!row) continue;
    const rowAccount = (row as any).meta?.stripe?.account_code ?? (row as any).meta?.account_code;
    if (rowAccount && rowAccount !== accountCode) continue;
    out.push({ payment_id: (row as any).id, payment_intent_id: pi });
  }
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function take(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => take());
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let raw: unknown;
  try { raw = await req.json().catch(() => ({})); } catch { return json({ error: 'invalid_json' }, 400); }
  const body = (raw ?? {}) as Body;

  // Auth: super_admin only.
  let actor: { user_id: string; email: string | null };
  let supabase: any;
  try {
    const guard = await requireSuperAdmin(req);
    actor = guard.user;
    supabase = guard.supabase;
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg.startsWith('forbidden') ? 'forbidden' : 'unauthorized', detail: msg }, msg.startsWith('forbidden') ? 403 : 401);
  }

  const dryRun = body.dry_run !== false; // default true
  const accountCode = body.account_code || 'stripe_poland';
  const limit = Math.min(Math.max(Number(body.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const concurrency = Math.min(Math.max(Number(body.concurrency ?? 1), 1), MAX_CONCURRENCY);
  const forceRefresh = body.force_refresh === true;

  // Build candidate list.
  let candidates: Candidate[];
  try {
    candidates = Array.isArray(body.payment_intents) && body.payment_intents.length > 0
      ? await resolveExplicitPi(supabase, body.payment_intents, accountCode)
      : await pickCandidatesFromDb(supabase, accountCode, limit);
  } catch (e) {
    return json({ error: 'candidate_resolution_failed', detail: (e as Error).message }, 500);
  }

  if (dryRun) {
    await supabase.from('audit_logs').insert({
      actor_user_id: actor.user_id,
      action: 'admin.stripe.card_data_bulk_dry_run',
      meta: {
        account_code: accountCode,
        limit, concurrency, force_refresh: forceRefresh,
        candidate_count: candidates.length,
        candidate_payment_ids: candidates.map((c) => c.payment_id),
      },
    });
    return json({
      ok: true,
      dry_run: true,
      account_code: accountCode,
      candidate_count: candidates.length,
      candidates: candidates.map((c) => ({
        payment_id: c.payment_id,
        payment_intent_id: c.payment_intent_id,
        verdict_pre: c.verdict_pre ?? 'ENRICHABLE',
      })),
    });
  }

  // Execute.
  const results: EnrichmentResult[] = await runWithConcurrency(candidates, concurrency, async (cand) => {
    return await enrichStripePaymentCardData({
      supabase,
      paymentId: cand.payment_id,
      paymentIntentId: cand.payment_intent_id,
      accountCode,
      source: 'bulk_fetch',
      actor: { type: 'user', user_id: actor.user_id, label: 'admin bulk fetch' },
      forceRefresh,
      fetchStripeSecret: (code) => readAcquiringSecret('stripe', code, 'secret_key').catch(() => null),
    });
  });

  const summary = {
    updated: 0, skipped_complete: 0, no_data: 0, invalid: 0, ambiguous: 0,
    retryable_no_payment_row: 0, conflicting_payment_intent_ids: 0, error: 0,
  } as Record<string, number>;
  for (const r of results) summary[r.verdict] = (summary[r.verdict] ?? 0) + 1;

  await supabase.from('audit_logs').insert({
    actor_user_id: actor.user_id,
    action: 'admin.stripe.card_data_bulk_run',
    meta: {
      account_code: accountCode,
      limit, concurrency, force_refresh: forceRefresh,
      candidate_count: candidates.length,
      summary,
      // NOTE: per-PI verdicts already audited inside enrichStripePaymentCardData.
      // Summary intentionally excludes any card data / Stripe response bodies.
    },
  });

  return json({
    ok: true,
    dry_run: false,
    account_code: accountCode,
    candidate_count: candidates.length,
    summary,
  });
});
