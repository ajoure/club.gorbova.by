// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B
// admin-payment-documents-resolve — read-only orchestrator.
//
// Approve B: code only. Function is NOT deployed in this gate.
//
// Hard contract:
//   - verify_jwt = true
//   - RBAC via has_role_v2(_user_id, _role_code) — existing roles only
//   - resolver NEVER writes to payments_v2 / orders_v2 / subscriptions_v2
//   - resolver NEVER triggers generation, number allocation, or document audit
//   - audit_logs INSERT happens ONLY on refresh_provider=true
//   - signed URLs are per-request, never persisted
//   - Stripe: exact retrieve only, no list/search, account+mode-aware
//   - bePaid: read-only local extract; no bepaid-get-payment-docs invocation
//   - refund: parent via meta.parent_payment_id only; no heuristics

import { corsHeaders } from '../_shared/cors.ts';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

import type {
  PaymentSummary, Provider, ProviderDocument, ResolverResponse,
  ResolverWarning,
} from '../_shared/payments/documents/types.ts';
import { resolveStripeDocuments, type StripeRetrieve, isExactStripeId } from '../_shared/payments/documents/stripe-documents.ts';
import { resolveBePaidDocuments } from '../_shared/payments/documents/bepaid-documents.ts';
import { resolveInternalDocuments, type InternalDocRow, type InternalDocSource, type SignedUrlSigner } from '../_shared/payments/documents/internal-documents.ts';
import { classifyGeneration } from '../_shared/payments/documents/generation-status.ts';

// ── Capability matrix (uses existing roles only; no new permissions) ─────────
const VIEW_ROLES = ['super_admin', 'admin', 'accountant'] as const;
const REFRESH_ROLES = ['super_admin', 'admin'] as const;
const DIAGNOSTICS_ROLES = ['super_admin'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body { payment_id: string; refresh_provider?: boolean }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Dependency injection seam (overridable by tests) ─────────────────────────
export interface ResolverDeps {
  supabase: SupabaseClient;
  actor: { user_id: string; email: string | null };
  capabilities: { canRefresh: boolean; canSeeDiagnostics: boolean };
  /** null → no stripe account resolved; resolveStripeDocuments will skip refresh */
  buildStripeClient: (account_code: string) => Promise<StripeRetrieve | null>;
  internalDocs: InternalDocSource;
  signer: SignedUrlSigner;
  auditWrite: (entry: { action: string; meta: Record<string, unknown> }) => Promise<void>;
}

// ── Core resolver — pure, takes deps, returns canonical response ─────────────
export async function resolvePaymentDocuments(
  paymentId: string,
  refreshProvider: boolean,
  deps: ResolverDeps,
): Promise<{ status: number; body: ResolverResponse | { error: string } }> {
  if (!UUID_RE.test(paymentId)) return { status: 400, body: { error: 'INVALID_REQUEST' } };

  const { data: payment, error: pErr } = await deps.supabase
    .from('payments_v2')
    .select('id, provider, status, amount, currency, order_id, meta, receipt_url, provider_payment_id')
    .eq('id', paymentId)
    .maybeSingle();
  if (pErr) return { status: 500, body: { error: 'INTERNAL_ERROR' } };
  if (!payment) return { status: 404, body: { error: 'PAYMENT_NOT_FOUND' } };

  const provider = (payment.provider ?? 'bepaid') as Provider;
  const meta = (payment.meta ?? {}) as Record<string, unknown>;
  const amount = typeof payment.amount === 'number' ? payment.amount : (payment.amount != null ? Number(payment.amount) : null);
  const isRefund = (amount ?? 0) < 0 || !!(meta as { is_refund?: boolean }).is_refund;

  const warnings: ResolverWarning[] = [];
  const diag: Record<string, unknown> = {};

  // ── Refund parent (canonical only) ─────────────────────────────────────────
  let parentMeta: Record<string, unknown> | null = null;
  let parentReceiptUrl: string | null = null;
  if (isRefund) {
    const parentId = (meta as { parent_payment_id?: string }).parent_payment_id ?? null;
    if (parentId && UUID_RE.test(parentId)) {
      const { data: parent } = await deps.supabase
        .from('payments_v2')
        .select('id, meta, receipt_url, provider_payment_id')
        .eq('id', parentId)
        .maybeSingle();
      if (parent) {
        parentMeta = (parent.meta ?? {}) as Record<string, unknown>;
        parentReceiptUrl = (parent as { receipt_url?: string | null }).receipt_url ?? null;
      }
    }
    if (!parentMeta) warnings.push({ code: 'REFUND_PARENT_NOT_RESOLVED', retryable: false });
  }

  // Effective meta for document extraction: parent's meta when refund, own otherwise.
  const effectiveMeta = (isRefund && parentMeta) ? parentMeta : meta;
  const effectiveReceiptUrl = (isRefund && parentMeta) ? parentReceiptUrl : (payment as { receipt_url?: string | null }).receipt_url ?? null;

  let providerDocs: ProviderDocument[] = [];
  let stripeAccountResolved: boolean | null = null;

  if (provider === 'stripe') {
    const s = (effectiveMeta as { stripe?: Record<string, unknown> }).stripe ?? {};
    const sm = s as {
      payment_intent_id?: string; charge_id?: string; invoice_id?: string;
      refund_id?: string; credit_note_id?: string; subscription_id?: string;
      account_code?: string;
      charge?: { receipt_url?: string | null };
      hosted_invoice_url?: string | null;
      invoice_pdf?: string | null;
      invoice?: { hosted_invoice_url?: string | null; invoice_pdf?: string | null };
      credit_note?: { pdf?: string | null };
    };
    const accountCode = sm.account_code ?? (effectiveMeta as { account_code?: string }).account_code ?? null;

    let stripeClient: StripeRetrieve | null = null;
    if (refreshProvider && deps.capabilities.canRefresh) {
      if (accountCode) {
        try { stripeClient = await deps.buildStripeClient(accountCode); }
        catch { stripeClient = null; }
      }
      stripeAccountResolved = !!stripeClient;
      if (!stripeClient) warnings.push({ code: 'PROVIDER_DOCUMENT_RETRIEVE_FAILED', retryable: true, detail: 'STRIPE_ACCOUNT_NOT_RESOLVED' });
    } else {
      // No refresh requested → not applicable, leave as null (drawer still shows locals).
      stripeAccountResolved = accountCode ? true : null;
    }

    const r = await resolveStripeDocuments({
      local: {
        ids: {
          payment_intent_id: sm.payment_intent_id ?? null,
          charge_id: sm.charge_id ?? null,
          invoice_id: sm.invoice_id ?? null,
          refund_id: sm.refund_id ?? null,
          credit_note_id: sm.credit_note_id ?? null,
          subscription_id: sm.subscription_id ?? null,
        },
        urls: {
          charge_receipt_url: sm.charge?.receipt_url ?? effectiveReceiptUrl ?? null,
          hosted_invoice_url: sm.hosted_invoice_url ?? sm.invoice?.hosted_invoice_url ?? null,
          invoice_pdf: sm.invoice_pdf ?? sm.invoice?.invoice_pdf ?? null,
          credit_note_pdf: sm.credit_note?.pdf ?? null,
        },
      },
      refresh: refreshProvider && deps.capabilities.canRefresh && !!stripeClient,
      stripe: stripeClient,
      accountResolved: !!stripeClient,
    });
    providerDocs = r.documents;
    for (const w of r.warnings) warnings.push(w);
    diag.stripe = r.diagnostics;
  } else if (provider === 'bepaid') {
    const transaction = (effectiveMeta as { provider_response?: { transaction?: { uid?: string; receipt_url?: string } } })
      .provider_response?.transaction ?? {};
    const r = resolveBePaidDocuments({
      receipt_url: effectiveReceiptUrl,
      provider_payment_id: (payment as { provider_payment_id?: string }).provider_payment_id ?? null,
      transaction_uid: transaction.uid ?? null,
      transaction_receipt_url: transaction.receipt_url ?? null,
    }, refreshProvider && deps.capabilities.canRefresh);
    providerDocs = r.documents;
    for (const w of r.warnings) warnings.push(w);
  }

  // ── Internal canonical documents (UUID-only relation) ──────────────────────
  const effectiveOrderId = (isRefund && parentMeta)
    ? await resolveParentOrderId(deps.supabase, (meta as { parent_payment_id?: string }).parent_payment_id ?? null)
    : (payment.order_id ?? null);

  const internal = await resolveInternalDocuments(effectiveOrderId, deps.internalDocs, deps.signer);

  // ── Generation status (read-only classification only) ──────────────────────
  const generation = classifyGeneration({
    order_id: effectiveOrderId,
    is_refund: isRefund,
    stripe_account_resolved: provider === 'stripe' ? stripeAccountResolved : null,
    internal_documents: internal,
    // scenario_found / progress / failed / missing — not detected in Approve B
    scenario_found: false,
  });

  // ── Audit on refresh only ──────────────────────────────────────────────────
  if (refreshProvider && deps.capabilities.canRefresh) {
    try {
      await deps.auditWrite({
        action: 'admin.payment_documents.provider_refresh',
        meta: {
          payment_id: paymentId,
          provider,
          actor_user_id: deps.actor.user_id,
          document_types_found: providerDocs.filter((d) => d.status === 'available').map((d) => d.type),
          source: providerDocs.map((d) => d.source),
          verdict: providerDocs.some((d) => d.status === 'available') ? 'SUCCESS'
            : warnings.find((w) => w.code === 'BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY') ? 'READ_ONLY_REFRESH_UNAVAILABLE'
            : stripeAccountResolved === false ? 'ACCOUNT_NOT_RESOLVED'
            : warnings.some((w) => w.code === 'PROVIDER_DOCUMENT_RETRIEVE_FAILED') ? 'PROVIDER_ERROR'
            : 'NO_DOCUMENTS',
          safe_error_code: warnings.find((w) => w.code === 'PROVIDER_DOCUMENT_RETRIEVE_FAILED')?.detail ?? null,
          retryable: warnings.some((w) => w.retryable === true),
        },
      });
    } catch { /* audit failure must not break drawer */ }
  }

  const body: ResolverResponse = {
    payment: {
      id: paymentId,
      provider,
      status: String(payment.status ?? ''),
      amount,
      currency: (payment.currency as string | null) ?? null,
      order_id: payment.order_id ?? null,
      is_refund: isRefund,
    },
    provider_documents: providerDocs,
    internal_documents: internal,
    generation,
    diagnostics: deps.capabilities.canSeeDiagnostics ? diag : null,
    warnings,
  };
  return { status: 200, body };
}

async function resolveParentOrderId(supabase: SupabaseClient, parentId: string | null): Promise<string | null> {
  if (!parentId || !UUID_RE.test(parentId)) return null;
  const { data } = await supabase.from('payments_v2').select('order_id').eq('id', parentId).maybeSingle();
  return (data?.order_id as string | null) ?? null;
}

// ── HTTP entrypoint ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'INVALID_REQUEST' }, 400);

  let body: Partial<Body>;
  try { body = await req.json(); } catch { return json({ error: 'INVALID_REQUEST' }, 400); }
  if (!body.payment_id || typeof body.payment_id !== 'string') return json({ error: 'INVALID_REQUEST' }, 400);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'UNAUTHORIZED' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: uErr } = await supabase.auth.getUser(token);
  if (uErr || !user) return json({ error: 'UNAUTHORIZED' }, 401);

  // RBAC via existing helper.
  const roleChecks = await Promise.all(
    VIEW_ROLES.map((r) => supabase.rpc('has_role_v2', { _user_id: user.id, _role_code: r })),
  );
  const grantedRoles = new Set(VIEW_ROLES.filter((_r, i) => !!roleChecks[i].data));
  if (grantedRoles.size === 0) return json({ error: 'FORBIDDEN' }, 403);

  const canRefresh = REFRESH_ROLES.some((r) => grantedRoles.has(r));
  const canSeeDiagnostics = DIAGNOSTICS_ROLES.some((r) => grantedRoles.has(r));
  const refreshProvider = body.refresh_provider === true && canRefresh;

  // Internal docs source (read-only).
  const internalDocs = {
    async list(orderId: string): Promise<InternalDocRow[]> {
      const { data } = await supabase
        .from('ai_generated_documents')
        .select('id, order_id, document_type, status, number, storage_path, file_name, created_at')
        .eq('order_id', orderId);
      return (data ?? []) as InternalDocRow[];
    },
  };

  const signer: SignedUrlSigner = {
    async sign(storagePath, _fileName, ttlSeconds) {
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, ttlSeconds);
      if (error || !data?.signedUrl) return null;
      return { url: data.signedUrl, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
    },
  };

  // Stripe client builder — Approve B leaves provider HTTP unwired (read-only stub).
  // Production wiring lands in Approve D (canonical secret resolver + stripeFetch).
  const buildStripeClient = async (_account_code: string): Promise<StripeRetrieve | null> => null;

  const auditWrite = async (entry: { action: string; meta: Record<string, unknown> }) => {
    await supabase.from('audit_logs').insert({
      action: entry.action,
      actor_type: 'user',
      actor_user_id: user.id,
      meta: entry.meta,
    });
  };

  try {
    const r = await resolvePaymentDocuments(body.payment_id, refreshProvider, {
      supabase,
      actor: { user_id: user.id, email: user.email ?? null },
      capabilities: { canRefresh, canSeeDiagnostics },
      buildStripeClient,
      internalDocs,
      signer,
      auditWrite,
    });
    return json(r.body, r.status);
  } catch {
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});

// Re-export helpers for tests.
export { isExactStripeId };
