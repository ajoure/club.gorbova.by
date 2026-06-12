// ============================================================================
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A
// _shared/stripe/card-enrichment.ts
//
// Единственный writer Stripe card data в payments_v2.
//
// Используется тремя точками:
//   1) supabase/functions/stripe-webhook/index.ts
//        (3 events: checkout.session.completed, payment_intent.succeeded,
//        invoice.paid — после того как существующий lifecycle материализовал
//        payments_v2.id)
//   2) supabase/functions/stripe-card-data-fetch/index.ts (single targeted)
//   3) supabase/functions/stripe-card-data-fetch-bulk/index.ts (admin bulk)
//
// Зоны ответственности:
//   - resolveStripeCardSource()     — GET PaymentIntent (expand=latest_charge)
//   - buildSanitizedCardSnapshot()  — pure sanitizer (card-extract.ts)
//   - persistStripeCardSnapshot()   — единственный DB UPDATE
//   - enrichStripePaymentCardData() — orchestration + guards + audit
//
// Контракты:
//   - НЕ создаёт payments_v2 rows.
//   - НЕ создаёт orders_v2 / entitlements / access.
//   - НЕ повторяет lifecycle (onInvoicePaid и т.п.).
//   - НЕ затирает non-null значения NULL.
//   - НЕ затирает Apple Pay wallet событием без wallet.
//   - НЕ обновляет refund-rows (amount < 0).
//   - НЕ обновляет bePaid.
//   - Idempotency: complete snapshot → skip (если force_refresh=false).
//   - Анти-concurrency: 60-секундный lock от parallel race.
//   - При >1 положительной строке на один PI → STOP, ambiguous.
//
// Canonical meta paths (единственно допустимые):
//   meta.stripe.payment_method_details          (sanitized snapshot)
//   meta.stripe.payment_method_id               (pm_*)
//   meta.stripe.charge_id                       (ch_*)
//   meta.stripe.payment_intent_id               (pi_*)
//   meta.stripe.card_data_source                (last source)
//   meta.stripe.card_data_sources_seen          (dedup array)
//   meta.stripe.card_data_fetched_at            (ISO timestamp)
//
// Запрещено: meta.card_data_fetched_at / meta.card_data_source (legacy).
// ============================================================================

import {
  assertNoPciFields,
  extractCardFromCharge,
  type CardExtractResult,
  type SanitizedCardSnapshot,
} from './card-extract.ts';

export type EnrichmentSource =
  | 'checkout.session.completed'
  | 'payment_intent.succeeded'
  | 'invoice.paid'
  | 'targeted_fetch'
  | 'bulk_fetch';

export type EnrichmentVerdict =
  | 'updated'
  | 'skipped_complete'
  | 'no_data'
  | 'invalid'
  | 'ambiguous'
  | 'conflicting_payment_intent_ids'
  | 'retryable_no_payment_row'
  | 'error';

export interface EnrichmentActor {
  type: 'system' | 'user';
  user_id?: string | null;
  label: string;
}

export interface EnrichmentInput {
  supabase: any;                       // SupabaseClient
  paymentId: string;
  paymentIntentId: string;             // pi_*
  accountCode: string;                 // 'stripe_poland' и т.п.
  source: EnrichmentSource;
  actor: EnrichmentActor;
  forceRefresh?: boolean;
  // Optional: caller may pass an already-fetched Charge (e.g. webhook
  // already did expand=latest_charge). When provided, we skip Stripe fetch.
  preloadedCharge?: unknown;
  // Optional: stripe secret key fetcher (injected for testability).
  fetchStripeSecret?: (accountCode: string) => Promise<string | null>;
  // Optional: HTTP fetch (injected for testability).
  httpFetch?: typeof fetch;
}

export interface EnrichmentResult {
  verdict: EnrichmentVerdict;
  payment_id: string;
  payment_intent_id: string;
  account_code: string;
  source: EnrichmentSource;
  updated_fields?: {
    card_brand?: boolean;
    card_last4?: boolean;
    card_holder?: boolean;
    payment_method_details?: boolean;
    payment_method_id?: boolean;
    charge_id?: boolean;
  };
  reason?: string;
  http_status?: number;
  stripe_error_type?: string | null;
  stripe_error_code?: string | null;
  request_id?: string | null;
  retryable?: boolean;
}

const PI_REGEX = /^pi_[A-Za-z0-9_]+$/;
const PM_REGEX = /^pm_[A-Za-z0-9_]+$/;
const CH_REGEX = /^ch_[A-Za-z0-9_]+$/;
const ANTI_CONCURRENCY_LOCK_MS = 60_000;

// =============================================================================
// PI resolver — extracts payment_intent_id from multiple meta paths.
// =============================================================================

export interface PaymentRowForPi {
  id: string;
  provider: string | null;
  amount: number | null;
  provider_payment_id: string | null;
  meta: Record<string, any> | null;
}

export type PiResolveResult =
  | { ok: true; payment_intent_id: string; sources: string[] }
  | { ok: false; reason: 'no_payment_intent' | 'conflicting_payment_intent_ids'; candidates?: Record<string, string> };

export function resolvePaymentIntentFromRow(row: PaymentRowForPi): PiResolveResult {
  const meta = row.meta || {};
  const candidates: Record<string, string> = {};
  const stripeMeta = (meta.stripe && typeof meta.stripe === 'object') ? meta.stripe : {};
  const providerResp = (meta.provider_response && typeof meta.provider_response === 'object')
    ? (meta.provider_response.stripe ?? {}) : {};

  const a = stripeMeta.payment_intent_id;
  if (typeof a === 'string' && PI_REGEX.test(a)) candidates['meta.stripe.payment_intent_id'] = a;

  const b = row.provider_payment_id;
  if (typeof b === 'string' && PI_REGEX.test(b)) candidates['provider_payment_id'] = b;

  const c = stripeMeta.invoice?.payment_intent;
  if (typeof c === 'string' && PI_REGEX.test(c)) candidates['meta.stripe.invoice.payment_intent'] = c;

  const d = providerResp.payment_intent_id;
  if (typeof d === 'string' && PI_REGEX.test(d)) candidates['meta.provider_response.stripe.payment_intent_id'] = d;

  const unique = new Set(Object.values(candidates));
  if (unique.size === 0) return { ok: false, reason: 'no_payment_intent' };
  if (unique.size > 1) return { ok: false, reason: 'conflicting_payment_intent_ids', candidates };
  const pi = unique.values().next().value as string;
  return { ok: true, payment_intent_id: pi, sources: Object.keys(candidates) };
}

// =============================================================================
// "Complete snapshot" predicate.
// =============================================================================

export interface PaymentRowForCompleteness {
  card_brand: string | null;
  card_last4: string | null;
  meta: Record<string, any> | null;
}

export function isCardSnapshotComplete(row: PaymentRowForCompleteness): boolean {
  const meta = row.meta || {};
  const s = (meta.stripe && typeof meta.stripe === 'object') ? meta.stripe : {};
  return Boolean(
    row.card_brand &&
    row.card_last4 &&
    s.payment_method_details &&
    typeof s.payment_method_details === 'object' &&
    s.payment_method_id &&
    s.charge_id,
  );
}

// =============================================================================
// resolveStripeCardSource — GET PaymentIntent with expand=latest_charge.
// =============================================================================

export interface ResolvedCardSource {
  ok: boolean;
  charge: unknown | null;
  http_status?: number;
  stripe_error_type?: string | null;
  stripe_error_code?: string | null;
  request_id?: string | null;
  retryable?: boolean;
  error_reason?: string;
}

export async function resolveStripeCardSource(args: {
  paymentIntentId: string;
  secretKey: string;
  httpFetch?: typeof fetch;
}): Promise<ResolvedCardSource> {
  const f = args.httpFetch ?? fetch;
  const url = `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(args.paymentIntentId)}?expand[]=latest_charge`;
  let resp: Response;
  try {
    resp = await f(url, { method: 'GET', headers: { Authorization: `Bearer ${args.secretKey}` } });
  } catch (e) {
    return { ok: false, charge: null, retryable: true, error_reason: 'fetch_failed' };
  }
  const request_id = resp.headers.get('request-id');
  let body: any = null;
  try { body = await resp.json(); } catch { /* ignore */ }
  if (!resp.ok) {
    return {
      ok: false,
      charge: null,
      http_status: resp.status,
      stripe_error_type: body?.error?.type ?? null,
      stripe_error_code: body?.error?.code ?? null,
      request_id,
      retryable: resp.status >= 500 || resp.status === 429,
      error_reason: 'stripe_api_error',
    };
  }
  const latest = body?.latest_charge;
  const charge = (latest && typeof latest === 'object') ? latest : null;
  return { ok: true, charge, http_status: resp.status, request_id };
}

// =============================================================================
// buildSanitizedCardSnapshot — pure (delegates to card-extract).
// =============================================================================

export function buildSanitizedCardSnapshot(charge: unknown): CardExtractResult {
  return extractCardFromCharge(charge);
}

// =============================================================================
// persistStripeCardSnapshot — single DB writer.
//
// Non-destructive merge. Atomic UPDATE with strict WHERE-guards.
// =============================================================================

export interface PersistInput {
  supabase: any;
  paymentId: string;
  paymentIntentId: string;
  extract: CardExtractResult;
  source: EnrichmentSource;
  forceRefresh: boolean;
  // Existing row snapshot for merge decisions.
  existing: {
    card_brand: string | null;
    card_last4: string | null;
    card_holder: string | null;
    meta: Record<string, any> | null;
  };
}

export interface PersistResult {
  updated: boolean;
  updated_fields: EnrichmentResult['updated_fields'];
}

export async function persistStripeCardSnapshot(input: PersistInput): Promise<PersistResult> {
  const { supabase, paymentId, paymentIntentId, extract, source, forceRefresh, existing } = input;

  const meta = (existing.meta && typeof existing.meta === 'object') ? { ...existing.meta } : {};
  const stripeMeta: Record<string, any> = (meta.stripe && typeof meta.stripe === 'object')
    ? { ...meta.stripe }
    : {};

  const updated_fields: EnrichmentResult['updated_fields'] = {};
  const updates: Record<string, any> = {};

  // ---- DB columns (non-destructive: never null-over-non-null) ----
  if (extract.card_brand && extract.card_brand !== existing.card_brand) {
    updates.card_brand = extract.card_brand;
    updated_fields.card_brand = true;
  }
  if (extract.card_last4 && extract.card_last4 !== existing.card_last4) {
    updates.card_last4 = extract.card_last4;
    updated_fields.card_last4 = true;
  }
  if (extract.card_holder && extract.card_holder !== existing.card_holder) {
    updates.card_holder = extract.card_holder;
    updated_fields.card_holder = true;
  }

  // ---- meta.stripe.payment_method_details (non-destructive merge) ----
  if (extract.snapshot) {
    const prev = (stripeMeta.payment_method_details && typeof stripeMeta.payment_method_details === 'object')
      ? stripeMeta.payment_method_details as SanitizedCardSnapshot
      : null;
    const prevCard = prev?.card ?? null;
    const newCard = extract.snapshot.card;
    const mergedCard = {
      brand: newCard.brand ?? prevCard?.brand ?? null,
      last4: newCard.last4 ?? prevCard?.last4 ?? null,
      // Never overwrite wallet with null — preserve Apple/Google Pay if previously seen.
      wallet: newCard.wallet ?? prevCard?.wallet ?? null,
      funding: newCard.funding ?? prevCard?.funding ?? null,
      country: newCard.country ?? prevCard?.country ?? null,
    };
    const mergedSnapshot: SanitizedCardSnapshot = { type: 'card', card: mergedCard };
    // Defensive: ensure nothing forbidden in the FINAL persisted payload.
    assertNoPciFields(mergedSnapshot, 'persist_payment_method_details');
    // Only write if the merged result actually changed.
    if (JSON.stringify(prev) !== JSON.stringify(mergedSnapshot)) {
      stripeMeta.payment_method_details = mergedSnapshot;
      updated_fields.payment_method_details = true;
    }
  }

  // ---- meta.stripe.payment_method_id (set-if-absent or force) ----
  if (extract.payment_method_id && PM_REGEX.test(extract.payment_method_id)) {
    if (!stripeMeta.payment_method_id || forceRefresh) {
      if (stripeMeta.payment_method_id !== extract.payment_method_id) {
        stripeMeta.payment_method_id = extract.payment_method_id;
        updated_fields.payment_method_id = true;
      }
    }
  }

  // ---- meta.stripe.charge_id (last-write-wins; both sides validated) ----
  if (extract.charge_id && CH_REGEX.test(extract.charge_id)) {
    if (stripeMeta.charge_id !== extract.charge_id) {
      stripeMeta.charge_id = extract.charge_id;
      updated_fields.charge_id = true;
    }
  }

  // ---- meta.stripe.payment_intent_id (set-if-absent) ----
  if (PI_REGEX.test(paymentIntentId) && !stripeMeta.payment_intent_id) {
    stripeMeta.payment_intent_id = paymentIntentId;
  }

  // ---- Provenance bookkeeping ----
  const sourcesSeen: string[] = Array.isArray(stripeMeta.card_data_sources_seen)
    ? [...stripeMeta.card_data_sources_seen]
    : [];
  if (!sourcesSeen.includes(source)) sourcesSeen.push(source);

  const hasAnyChange =
    updated_fields.card_brand ||
    updated_fields.card_last4 ||
    updated_fields.card_holder ||
    updated_fields.payment_method_details ||
    updated_fields.payment_method_id ||
    updated_fields.charge_id;

  if (!hasAnyChange) {
    return { updated: false, updated_fields };
  }

  stripeMeta.card_data_source = source;
  stripeMeta.card_data_sources_seen = sourcesSeen;
  stripeMeta.card_data_fetched_at = new Date().toISOString();
  meta.stripe = stripeMeta;
  updates.meta = meta;

  // Final defensive PCI scan of the entire persisted payload.
  assertNoPciFields(updates, 'persist_update_payload');

  // Atomic UPDATE with strict WHERE guards (id + provider + amount>0 + PI match).
  const { error } = await supabase
    .from('payments_v2')
    .update(updates)
    .eq('id', paymentId)
    .eq('provider', 'stripe')
    .gt('amount', 0)
    .eq('provider_payment_id', paymentIntentId);

  if (error) {
    throw new Error(`payments_v2_update_failed: ${error.message}`);
  }

  return { updated: true, updated_fields };
}

// =============================================================================
// writeAudit — safe audit shape (PCI-clean by construction).
// =============================================================================

function actorAuditFields(actor: EnrichmentActor): Record<string, any> {
  if (actor.type === 'system') {
    return {
      actor_user_id: null,
      meta_actor: { type: 'system', label: actor.label },
    };
  }
  return {
    actor_user_id: actor.user_id ?? null,
    meta_actor: { type: 'user', label: actor.label, user_id: actor.user_id ?? null },
  };
}

async function writeEnrichmentAudit(
  supabase: any,
  action: string,
  actor: EnrichmentActor,
  meta: Record<string, any>,
): Promise<void> {
  const safeMeta = { ...meta, ...actorAuditFields(actor).meta_actor && { actor: actorAuditFields(actor).meta_actor } };
  // Defensive: never let PCI fields leak into audit_logs.
  assertNoPciFields(safeMeta, 'audit_meta');
  try {
    await supabase.from('audit_logs').insert({
      action,
      actor_user_id: actorAuditFields(actor).actor_user_id,
      meta: safeMeta,
    });
  } catch {
    // never re-throw from audit writer
  }
}

// =============================================================================
// enrichStripePaymentCardData — public orchestration entrypoint.
// =============================================================================

export async function enrichStripePaymentCardData(input: EnrichmentInput): Promise<EnrichmentResult> {
  const {
    supabase, paymentId, paymentIntentId, accountCode, source, actor,
    forceRefresh = false, preloadedCharge, fetchStripeSecret, httpFetch,
  } = input;

  const baseResult = {
    payment_id: paymentId,
    payment_intent_id: paymentIntentId,
    account_code: accountCode,
    source,
  };

  // 1. Validate PI shape early.
  if (!paymentIntentId || !PI_REGEX.test(paymentIntentId)) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.invalid', actor, {
      ...baseResult, reason: 'invalid_payment_intent_format',
    });
    return { ...baseResult, verdict: 'invalid', reason: 'invalid_payment_intent_format' };
  }

  // 2. Load the target payment row.
  const { data: payment, error: loadErr } = await supabase
    .from('payments_v2')
    .select('id, provider, amount, provider_payment_id, card_brand, card_last4, card_holder, meta')
    .eq('id', paymentId)
    .maybeSingle();
  if (loadErr) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
      ...baseResult, reason: 'payment_load_failed', error: loadErr.message,
    });
    return { ...baseResult, verdict: 'error', reason: 'payment_load_failed' };
  }
  if (!payment) {
    // For webhook events the row may not yet exist if upstream lifecycle failed.
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.retryable_no_payment_row', actor, {
      ...baseResult, reason: 'payment_not_found',
    });
    return { ...baseResult, verdict: 'retryable_no_payment_row', reason: 'payment_not_found' };
  }

  // 3. Hard pre-conditions.
  if (payment.provider !== 'stripe') {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.invalid', actor, {
      ...baseResult, reason: 'not_stripe_provider', provider: payment.provider,
    });
    return { ...baseResult, verdict: 'invalid', reason: 'not_stripe_provider' };
  }
  if (!(Number(payment.amount) > 0)) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.invalid', actor, {
      ...baseResult, reason: 'refund_or_zero_amount', amount: payment.amount,
    });
    return { ...baseResult, verdict: 'invalid', reason: 'refund_or_zero_amount' };
  }
  if (payment.provider_payment_id !== paymentIntentId) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.invalid', actor, {
      ...baseResult, reason: 'pi_mismatch', row_pi: payment.provider_payment_id,
    });
    return { ...baseResult, verdict: 'invalid', reason: 'pi_mismatch' };
  }
  // Account-code consistency check (skip if absent on row — older data).
  const rowAccountCode = payment.meta?.stripe?.account_code;
  if (rowAccountCode && rowAccountCode !== accountCode) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.invalid', actor, {
      ...baseResult, reason: 'account_code_mismatch', row_account_code: rowAccountCode,
    });
    return { ...baseResult, verdict: 'invalid', reason: 'account_code_mismatch' };
  }

  // 4. Ambiguous PI guard — multiple positive Stripe rows with same PI.
  const { count: dupCount, error: dupErr } = await supabase
    .from('payments_v2')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'stripe')
    .eq('provider_payment_id', paymentIntentId)
    .gt('amount', 0);
  if (dupErr) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
      ...baseResult, reason: 'duplicate_check_failed', error: dupErr.message,
    });
    return { ...baseResult, verdict: 'error', reason: 'duplicate_check_failed' };
  }
  if ((dupCount ?? 0) > 1) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.manual_review_duplicate_payment_intent', actor, {
      ...baseResult, reason: 'duplicate_positive_payment_intent', duplicate_count: dupCount,
    });
    return { ...baseResult, verdict: 'ambiguous', reason: 'duplicate_positive_payment_intent' };
  }

  // 5. Idempotency main guard: complete snapshot.
  if (!forceRefresh && isCardSnapshotComplete(payment)) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.skipped_complete', actor, {
      ...baseResult, reason: 'already_complete',
    });
    return { ...baseResult, verdict: 'skipped_complete', reason: 'already_complete' };
  }

  // 6. Anti-concurrency lock (60s) — independent from idempotency.
  const lastFetchedAt = payment.meta?.stripe?.card_data_fetched_at;
  if (!forceRefresh && typeof lastFetchedAt === 'string') {
    const last = Date.parse(lastFetchedAt);
    if (Number.isFinite(last) && Date.now() - last < ANTI_CONCURRENCY_LOCK_MS) {
      await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.skipped_recent', actor, {
        ...baseResult, reason: 'anti_concurrency_lock', last_fetched_at: lastFetchedAt,
      });
      return { ...baseResult, verdict: 'skipped_complete', reason: 'anti_concurrency_lock' };
    }
  }

  // 7. Resolve Charge — either preloaded or via Stripe API.
  let charge: unknown = preloadedCharge ?? null;
  let apiCtx: Partial<EnrichmentResult> = {};
  if (!charge) {
    if (!fetchStripeSecret) {
      await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
        ...baseResult, reason: 'no_stripe_secret_fetcher',
      });
      return { ...baseResult, verdict: 'error', reason: 'no_stripe_secret_fetcher' };
    }
    let sk: string | null = null;
    try { sk = await fetchStripeSecret(accountCode); } catch { /* swallow */ }
    if (!sk) {
      await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
        ...baseResult, reason: 'stripe_secret_unavailable',
      });
      return { ...baseResult, verdict: 'error', reason: 'stripe_secret_unavailable', retryable: true };
    }
    const src = await resolveStripeCardSource({ paymentIntentId, secretKey: sk, httpFetch });
    apiCtx = {
      http_status: src.http_status,
      stripe_error_type: src.stripe_error_type ?? null,
      stripe_error_code: src.stripe_error_code ?? null,
      request_id: src.request_id ?? null,
      retryable: src.retryable,
    };
    if (!src.ok) {
      await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
        ...baseResult, ...apiCtx, reason: src.error_reason ?? 'stripe_api_error',
      });
      return { ...baseResult, ...apiCtx, verdict: 'error', reason: src.error_reason ?? 'stripe_api_error' };
    }
    charge = src.charge;
  }

  // 8. Sanitize.
  const extract = buildSanitizedCardSnapshot(charge);
  if (!extract.hasAnyData) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.no_data', actor, {
      ...baseResult, ...apiCtx, reason: 'no_card_data_from_stripe',
    });
    return { ...baseResult, ...apiCtx, verdict: 'no_data', reason: 'no_card_data_from_stripe' };
  }

  // 9. Persist (single writer).
  let persist: PersistResult;
  try {
    persist = await persistStripeCardSnapshot({
      supabase, paymentId, paymentIntentId, extract, source, forceRefresh,
      existing: {
        card_brand: payment.card_brand,
        card_last4: payment.card_last4,
        card_holder: payment.card_holder,
        meta: payment.meta,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.error', actor, {
      ...baseResult, ...apiCtx, reason: 'persist_failed', error: msg,
    });
    return { ...baseResult, ...apiCtx, verdict: 'error', reason: 'persist_failed' };
  }

  if (!persist.updated) {
    await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.skipped_complete', actor, {
      ...baseResult, ...apiCtx, reason: 'no_changes_after_merge',
    });
    return { ...baseResult, ...apiCtx, verdict: 'skipped_complete', reason: 'no_changes_after_merge' };
  }

  await writeEnrichmentAudit(supabase, 'stripe.card_enrichment.updated', actor, {
    ...baseResult, ...apiCtx, updated_fields: persist.updated_fields,
    force_refresh: forceRefresh,
  });
  return {
    ...baseResult, ...apiCtx,
    verdict: 'updated',
    updated_fields: persist.updated_fields,
  };
}
