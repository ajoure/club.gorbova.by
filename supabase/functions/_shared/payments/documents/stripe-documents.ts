// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — Stripe adapter (read-only).
//
// Rules (hard):
//   - account+mode-aware via acquiring_connections.account_code (no live/default fallback)
//   - exact retrieve only by proven IDs (pi_, ch_, in_, re_, cn_, sub_)
//   - NO list/search/customer/email/amount/date lookup
//   - whitelisted fields only; full Stripe object never returned/logged
//   - credit note only by exact cn_*; never via invoice.creditNotes.list
//
// All Stripe HTTP calls are injected via `stripeClient` for testability.

import type { ProviderDocument, ResolverWarning } from './types.ts';
import { classifyProviderUrl } from './url-security.ts';

export interface StripeRetrieve {
  retrieve(
    resource: 'payment_intents' | 'charges' | 'invoices' | 'refunds' | 'credit_notes' | 'subscriptions',
    id: string,
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; error?: { code?: string; message?: string } }>;
}

export interface StripeLocalIds {
  payment_intent_id?: string | null;
  charge_id?: string | null;
  invoice_id?: string | null;
  refund_id?: string | null;
  credit_note_id?: string | null;
  subscription_id?: string | null;
}

export interface StripeLocalUrls {
  charge_receipt_url?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  credit_note_pdf?: string | null;
}

const ID_PATTERNS: Record<string, RegExp> = {
  payment_intents: /^pi_[A-Za-z0-9_]+$/,
  charges: /^ch_[A-Za-z0-9_]+$/,
  invoices: /^in_[A-Za-z0-9_]+$/,
  refunds: /^re_[A-Za-z0-9_]+$/,
  credit_notes: /^cn_[A-Za-z0-9_]+$/,
  subscriptions: /^sub_[A-Za-z0-9_]+$/,
};

export function isExactStripeId(kind: keyof typeof ID_PATTERNS, id: string | null | undefined): id is string {
  return !!id && ID_PATTERNS[kind].test(id);
}

interface BuildArgs {
  local: { ids: StripeLocalIds; urls: StripeLocalUrls };
  refresh: boolean;
  stripe: StripeRetrieve | null;       // null when account unresolved → still emit local docs
  accountResolved: boolean;
}

function makeDoc(
  type: ProviderDocument['type'],
  external_id: string | null,
  url: string | null,
  source: ProviderDocument['source'],
): ProviderDocument {
  const verdict = classifyProviderUrl(url);
  if (!verdict.safe) {
    return {
      provider: 'stripe',
      type,
      external_id,
      status: 'unavailable',
      source,
      url: null,
      url_kind: 'unavailable',
      can_open: false,
      can_download: false,
      can_copy: false,
      expires_at: null,
      warning: url ? 'UNSAFE_DOCUMENT_URL' : null,
    };
  }
  return {
    provider: 'stripe',
    type,
    external_id,
    status: 'available',
    source,
    url,
    url_kind: 'external_provider',
    can_open: true,
    can_download: false,
    can_copy: true,
    expires_at: null,
  };
}

export async function resolveStripeDocuments(
  args: BuildArgs,
): Promise<{ documents: ProviderDocument[]; warnings: ResolverWarning[]; diagnostics: Record<string, unknown> }> {
  const { local, refresh, stripe, accountResolved } = args;
  const docs: ProviderDocument[] = [];
  const warnings: ResolverWarning[] = [];
  const diag: Record<string, unknown> = { exact_retrieve_calls: 0, list_or_search_calls: 0 };

  // 1) Local first (dedup key per type+external_id).
  const indexedByKey = new Map<string, ProviderDocument>();
  const addLocal = (d: ProviderDocument) => {
    const key = `${d.type}:${d.external_id ?? '∅'}`;
    if (!indexedByKey.has(key)) indexedByKey.set(key, d);
  };

  if (local.urls.charge_receipt_url) {
    addLocal(makeDoc('receipt', local.ids.charge_id ?? null, local.urls.charge_receipt_url, 'local_meta'));
  }
  if (local.urls.hosted_invoice_url) {
    addLocal(makeDoc('hosted_invoice', local.ids.invoice_id ?? null, local.urls.hosted_invoice_url, 'local_meta'));
  }
  if (local.urls.invoice_pdf) {
    addLocal(makeDoc('invoice_pdf', local.ids.invoice_id ?? null, local.urls.invoice_pdf, 'local_meta'));
  }
  if (local.urls.credit_note_pdf) {
    addLocal(makeDoc('credit_note_pdf', local.ids.credit_note_id ?? null, local.urls.credit_note_pdf, 'local_meta'));
  }

  // 2) Provider refresh (only with explicit refresh=true, resolved account, AND we have exact IDs).
  if (refresh && stripe && accountResolved) {
    // 2a) Resolve receipt via charge_id (preferred) or via PI.latest_charge.
    let chargeId = isExactStripeId('charges', local.ids.charge_id) ? local.ids.charge_id! : null;
    if (!chargeId && isExactStripeId('payment_intents', local.ids.payment_intent_id)) {
      diag.exact_retrieve_calls = (diag.exact_retrieve_calls as number) + 1;
      const pi = await stripe.retrieve('payment_intents', local.ids.payment_intent_id!);
      if (pi.ok && pi.data) {
        const lc = (pi.data as { latest_charge?: string }).latest_charge;
        if (typeof lc === 'string' && isExactStripeId('charges', lc)) chargeId = lc;
      } else if (!pi.ok) {
        warnings.push({ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable: true, detail: pi.error?.code ?? null });
      }
    }
    if (chargeId) {
      diag.exact_retrieve_calls = (diag.exact_retrieve_calls as number) + 1;
      const ch = await stripe.retrieve('charges', chargeId);
      if (ch.ok && ch.data) {
        const url = (ch.data as { receipt_url?: string | null }).receipt_url ?? null;
        const merged = mergeDoc(indexedByKey, 'receipt', chargeId, url);
        if (merged) docs.push(merged);
      } else {
        warnings.push({ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable: true, detail: ch.error?.code ?? null });
      }
    }

    // 2b) Invoice (hosted + pdf).
    if (isExactStripeId('invoices', local.ids.invoice_id)) {
      diag.exact_retrieve_calls = (diag.exact_retrieve_calls as number) + 1;
      const inv = await stripe.retrieve('invoices', local.ids.invoice_id!);
      if (inv.ok && inv.data) {
        const d = inv.data as { hosted_invoice_url?: string | null; invoice_pdf?: string | null; id?: string };
        const m1 = mergeDoc(indexedByKey, 'hosted_invoice', d.id ?? local.ids.invoice_id!, d.hosted_invoice_url ?? null);
        if (m1) docs.push(m1);
        const m2 = mergeDoc(indexedByKey, 'invoice_pdf', d.id ?? local.ids.invoice_id!, d.invoice_pdf ?? null);
        if (m2) docs.push(m2);
      } else {
        warnings.push({ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable: true, detail: inv.error?.code ?? null });
      }
    }

    // 2c) Credit note — ONLY by exact cn_* id. Forbidden: creditNotes.list({ invoice }).
    if (isExactStripeId('credit_notes', local.ids.credit_note_id)) {
      diag.exact_retrieve_calls = (diag.exact_retrieve_calls as number) + 1;
      const cn = await stripe.retrieve('credit_notes', local.ids.credit_note_id!);
      if (cn.ok && cn.data) {
        const url = (cn.data as { pdf?: string | null }).pdf ?? null;
        const merged = mergeDoc(indexedByKey, 'credit_note_pdf', local.ids.credit_note_id!, url);
        if (merged) docs.push(merged);
      } else {
        warnings.push({ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable: true, detail: cn.error?.code ?? null });
      }
    }
  }

  // Surface remaining locals not already pushed via merge.
  for (const d of indexedByKey.values()) {
    if (!docs.find((x) => x === d || (x.type === d.type && x.external_id === d.external_id && x.source.includes('local_meta')))) {
      docs.push(d);
    }
  }

  return { documents: docs, warnings, diagnostics: diag };
}

function mergeDoc(
  index: Map<string, ProviderDocument>,
  type: ProviderDocument['type'],
  external_id: string,
  url: string | null,
): ProviderDocument | null {
  const key = `${type}:${external_id}`;
  const existing = index.get(key);
  const verdict = classifyProviderUrl(url);
  const safeUrl = verdict.safe ? url : null;
  const base: ProviderDocument = {
    provider: 'stripe',
    type,
    external_id,
    status: safeUrl ? 'available' : (url ? 'unavailable' : 'unavailable'),
    source: existing ? 'local_meta+provider_api' : 'provider_api',
    url: safeUrl,
    url_kind: safeUrl ? 'external_provider' : 'unavailable',
    can_open: !!safeUrl,
    can_download: false,
    can_copy: !!safeUrl,
    expires_at: null,
    warning: !verdict.safe && url ? 'UNSAFE_DOCUMENT_URL' : null,
  };
  if (existing) {
    index.delete(key);
    return base;
  }
  return base;
}
