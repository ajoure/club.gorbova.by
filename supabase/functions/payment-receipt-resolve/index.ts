// Resolve a provider receipt at click time.
//
// Stripe hosted receipt URLs expire. This endpoint therefore never returns a
// stored Stripe URL: it performs an exact-ID retrieve and returns only the
// freshly issued provider URL. The operation is read-only.

import { corsHeaders } from '../_shared/cors.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  createStripeClientForPayment,
  makeStripeRetrieveOverHttp,
  resolveStripeAccountCode,
  type ConnectionLookup,
  type ReadSecret,
  type StripeClientResolution,
} from '../_shared/payments/documents/stripe-client-factory.ts';
import { resolveStripeDocuments, type StripeRetrieve } from '../_shared/payments/documents/stripe-documents.ts';
import { resolveBePaidDocuments } from '../_shared/payments/documents/bepaid-documents.ts';
import type { ProviderDocument } from '../_shared/payments/documents/types.ts';
import { readAcquiringSecret } from '../_shared/acquiring/vault.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEW_ROLES = ['super_admin', 'admin', 'accountant'] as const;
const SUCCESS_STATUSES = new Set(['succeeded', 'successful', 'refunded', 'partially_refunded']);

type PaymentRow = {
  id: string;
  provider: string | null;
  provider_payment_id: string | null;
  status: string | null;
  order_id: string | null;
  receipt_url: string | null;
  meta: Record<string, unknown> | null;
};

export type ReceiptResolveResult =
  | { status: 200; body: { ok: true; payment_id: string; provider: string; url: string; document_type: string; can_download: boolean } }
  | { status: number; body: { ok: false; error: string; retryable?: boolean } };

export interface ReceiptResolverDeps {
  loadPayment(id: string): Promise<PaymentRow | null>;
  loadOrderOwner(orderId: string): Promise<string | null>;
  buildStripeClient(args: { accountCode: string | null; livemode: boolean | null; testMode: boolean | null }): Promise<StripeClientResolution>;
}

function exactProviderId(id: string | null, prefix: string): string | null {
  return id?.startsWith(prefix) ? id : null;
}

function pickFreshStripeDocument(documents: ProviderDocument[]): ProviderDocument | null {
  const fresh = documents.filter((document) =>
    document.status === 'available' &&
    !!document.url &&
    (document.source === 'provider_api' || document.source === 'local_meta+provider_api')
  );
  const priority: ProviderDocument['type'][] = ['receipt', 'invoice_pdf', 'hosted_invoice'];
  return fresh.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))[0] ?? null;
}

export async function resolveReceiptForActor(
  paymentId: string,
  actor: { userId: string; isStaff: boolean },
  deps: ReceiptResolverDeps,
): Promise<ReceiptResolveResult> {
  if (!UUID_RE.test(paymentId)) return { status: 400, body: { ok: false, error: 'INVALID_REQUEST' } };

  const payment = await deps.loadPayment(paymentId);
  if (!payment) return { status: 404, body: { ok: false, error: 'PAYMENT_NOT_FOUND' } };

  if (!actor.isStaff) {
    if (!payment.order_id) return { status: 403, body: { ok: false, error: 'FORBIDDEN' } };
    const ownerId = await deps.loadOrderOwner(payment.order_id);
    if (!ownerId || ownerId !== actor.userId) return { status: 403, body: { ok: false, error: 'FORBIDDEN' } };
  }

  if (!SUCCESS_STATUSES.has(String(payment.status ?? '').toLowerCase())) {
    return { status: 409, body: { ok: false, error: 'PAYMENT_NOT_SUCCESSFUL' } };
  }

  const provider = String(payment.provider ?? '').toLowerCase();
  const meta = payment.meta ?? {};

  if (provider === 'stripe') {
    const sm = ((meta as { stripe?: Record<string, unknown> }).stripe ?? {}) as {
      payment_intent_id?: string; charge_id?: string; invoice_id?: string;
      account_code?: string; livemode?: boolean; test_mode?: boolean;
      charge?: { receipt_url?: string | null };
      hosted_invoice_url?: string | null; invoice_pdf?: string | null;
      invoice?: { hosted_invoice_url?: string | null; invoice_pdf?: string | null };
    };
    const paymentIntentId = sm.payment_intent_id ?? exactProviderId(payment.provider_payment_id, 'pi_');
    const chargeId = sm.charge_id ?? exactProviderId(payment.provider_payment_id, 'ch_');
    const invoiceId = sm.invoice_id ?? exactProviderId(payment.provider_payment_id, 'in_');

    const account = resolveStripeAccountCode({
      stripeAccountCode: sm.account_code ?? null,
      rootAccountCode: (meta as { account_code?: string }).account_code ?? null,
    });
    if (!account.ok) {
      return { status: 409, body: { ok: false, error: 'STRIPE_PAYMENT_CONTEXT_NOT_RESOLVED' } };
    }

    const client = await deps.buildStripeClient({
      accountCode: account.accountCode,
      livemode: typeof sm.livemode === 'boolean' ? sm.livemode : null,
      testMode: typeof sm.test_mode === 'boolean' ? sm.test_mode : null,
    });
    if (!client.ok) {
      return { status: 502, body: { ok: false, error: 'STRIPE_RECEIPT_REFRESH_FAILED', retryable: client.retryable } };
    }

    const resolved = await resolveStripeDocuments({
      local: {
        ids: {
          payment_intent_id: paymentIntentId ?? null,
          charge_id: chargeId ?? null,
          invoice_id: invoiceId ?? null,
        },
        // Local URLs are provided only so a matching fresh provider document
        // can replace them. pickFreshStripeDocument rejects local-only values.
        urls: {
          charge_receipt_url: sm.charge?.receipt_url ?? payment.receipt_url,
          hosted_invoice_url: sm.hosted_invoice_url ?? sm.invoice?.hosted_invoice_url ?? null,
          invoice_pdf: sm.invoice_pdf ?? sm.invoice?.invoice_pdf ?? null,
        },
      },
      refresh: true,
      stripe: client.client,
      accountResolved: true,
    });
    const fresh = pickFreshStripeDocument(resolved.documents);
    if (!fresh?.url) {
      return { status: 502, body: { ok: false, error: 'STRIPE_RECEIPT_REFRESH_FAILED', retryable: true } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        payment_id: payment.id,
        provider,
        url: fresh.url,
        document_type: fresh.type,
        can_download: fresh.can_download,
      },
    };
  }

  if (provider === 'bepaid') {
    const transaction = (meta as { provider_response?: { transaction?: { uid?: string; receipt_url?: string } } })
      .provider_response?.transaction ?? {};
    const resolved = resolveBePaidDocuments({
      receipt_url: payment.receipt_url,
      provider_payment_id: payment.provider_payment_id,
      transaction_uid: transaction.uid ?? null,
      transaction_receipt_url: transaction.receipt_url ?? null,
    }, false);
    const document = resolved.documents.find((item) => item.status === 'available' && !!item.url);
    if (!document?.url) return { status: 404, body: { ok: false, error: 'RECEIPT_NOT_AVAILABLE' } };
    return {
      status: 200,
      body: {
        ok: true,
        payment_id: payment.id,
        provider,
        url: document.url,
        document_type: document.type,
        can_download: document.can_download,
      },
    };
  }

  return { status: 409, body: { ok: false, error: 'PROVIDER_NOT_SUPPORTED' } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function productionDeps(supabase: SupabaseClient): ReceiptResolverDeps {
  const lookupConnection: ConnectionLookup = {
    async list(accountCode: string) {
      const { data, error } = await supabase
        .from('acquiring_connections')
        .select('id, provider, account_code, test_mode, status')
        .eq('provider', 'stripe')
        .eq('account_code', accountCode)
        .eq('status', 'active');
      if (error || !Array.isArray(data)) return [];
      return data.map((row) => ({
        id: String(row.id),
        provider: 'stripe' as const,
        account_code: String(row.account_code),
        test_mode: !!row.test_mode,
        status: String(row.status),
      }));
    },
  };
  const readSecret: ReadSecret = (provider, accountCode, kind) => readAcquiringSecret(provider, accountCode, kind);
  return {
    async loadPayment(id) {
      const { data, error } = await supabase
        .from('payments_v2')
        .select('id, provider, provider_payment_id, status, order_id, receipt_url, meta')
        .eq('id', id)
        .maybeSingle();
      return error ? null : data as PaymentRow | null;
    },
    async loadOrderOwner(orderId) {
      const { data, error } = await supabase.from('orders_v2').select('user_id').eq('id', orderId).maybeSingle();
      return error ? null : (data?.user_id as string | null) ?? null;
    },
    async buildStripeClient(args) {
      let testMode = args.testMode;
      let livemode = args.livemode;

      // Legacy Stripe rows can have account_code but no mode metadata. Infer
      // the mode only from the single active connection for that exact
      // account. Never probe both live and test modes.
      if (testMode === null && livemode === null && args.accountCode) {
        const rows = await lookupConnection.list(args.accountCode);
        if (rows.length !== 1) {
          return { ok: false, code: 'STRIPE_MODE_NOT_RESOLVED', retryable: false };
        }
        testMode = rows[0].test_mode;
        livemode = !testMode;
      }

      return createStripeClientForPayment({
        ...args,
        testMode,
        livemode,
      }, {
        lookupConnection,
        readSecret,
        makeRetrieve: (secret: string): StripeRetrieve => makeStripeRetrieveOverHttp(secret),
      });
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'INVALID_REQUEST' }, 400);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  let body: { payment_id?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'INVALID_REQUEST' }, 400); }
  if (typeof body.payment_id !== 'string') return json({ ok: false, error: 'INVALID_REQUEST' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !user) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  const roleChecks = await Promise.all(
    VIEW_ROLES.map((role) => supabase.rpc('has_role_v2', { _user_id: user.id, _role_code: role })),
  );
  const isStaff = roleChecks.some((result) => result.data === true);

  try {
    const result = await resolveReceiptForActor(body.payment_id, { userId: user.id, isStaff }, productionDeps(supabase));
    return json(result.body, result.status);
  } catch {
    return json({ ok: false, error: 'INTERNAL_ERROR' }, 500);
  }
});
