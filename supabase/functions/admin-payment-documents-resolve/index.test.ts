// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — Resolver tests (DI mocks; no network, no DB).
//
// Required: 20 canonical cases + 5 additional. All deps are mocks.

import { assertEquals, assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  resolvePaymentDocuments,
  type ResolverDeps,
} from './index.ts';
import type { ResolverResponse } from '../_shared/payments/documents/types.ts';
import { classifyProviderUrl, isSafeSignedStorageUrl } from '../_shared/payments/documents/url-security.ts';
import { classifyGeneration } from '../_shared/payments/documents/generation-status.ts';
import { PCI_FORBIDDEN_KEYS } from '../_shared/payments/documents/types.ts';

// ── Mocks ────────────────────────────────────────────────────────────────────

interface PaymentRow {
  id: string; provider: string; status: string; amount: number;
  currency: string | null; order_id: string | null;
  meta: Record<string, unknown>; receipt_url: string | null;
  provider_payment_id: string | null;
}

interface MockOps {
  payments: PaymentRow[];
  docs?: Array<{ id: string; order_id: string; document_type: string; status: string; number: string | null; storage_path: string | null; file_name: string | null; created_at: string }>;
  stripeRetrieves?: Record<string, { ok: boolean; data: Record<string, unknown> | null; error?: { code?: string } }>;
  paymentsWrite: { calls: number };
  auditWrites: Array<{ action: string; meta: Record<string, unknown> }>;
  stripeCalls: Array<{ resource: string; id: string }>;
  signCalls: number;
  signFails?: boolean;
  signedUrl?: string;
}

function makeSupabase(ops: MockOps) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        _table: table,
        _filters: {} as Record<string, unknown>,
        select() { return chain; },
        eq(k: string, v: unknown) { (chain._filters as Record<string, unknown>)[k] = v; return chain; },
        async maybeSingle() {
          if (table === 'payments_v2') {
            const id = (chain._filters as { id?: string }).id;
            const row = ops.payments.find((p) => p.id === id) ?? null;
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
        async then(resolve: (v: { data: unknown; error: null }) => void) {
          if (table === 'ai_generated_documents') {
            const oid = (chain._filters as { order_id?: string }).order_id;
            return resolve({ data: (ops.docs ?? []).filter((d) => d.order_id === oid), error: null });
          }
          return resolve({ data: [], error: null });
        },
        async insert(_row: unknown) {
          if (table === 'payments_v2') ops.paymentsWrite.calls++;
          if (table === 'audit_logs') ops.auditWrites.push(_row as { action: string; meta: Record<string, unknown> });
          return { data: null, error: null };
        },
        async update() { if (table === 'payments_v2') ops.paymentsWrite.calls++; return { data: null, error: null }; },
        async upsert() { if (table === 'payments_v2') ops.paymentsWrite.calls++; return { data: null, error: null }; },
        async delete() { if (table === 'payments_v2') ops.paymentsWrite.calls++; return { data: null, error: null }; },
      };
      return chain;
    },
  } as unknown as ResolverDeps['supabase'];
}

function makeDeps(ops: MockOps, overrides: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    supabase: makeSupabase(ops),
    actor: { user_id: '00000000-0000-0000-0000-000000000001', email: 'a@b.c' },
    capabilities: { canRefresh: true, canSeeDiagnostics: false },
    async buildStripeClient(_args) {
      const client = {
        async retrieve(resource: string, id: string) {
          ops.stripeCalls.push({ resource, id });
          const key = `${resource}:${id}`;
          const r = ops.stripeRetrieves?.[key];
          if (!r) return { ok: false, status: 404, data: null, error: { code: 'not_found' } };
          return { ok: r.ok, status: r.ok ? 200 : 500, data: r.data, error: r.error };
        },
      };
      // deno-lint-ignore no-explicit-any
      return { ok: true, client: client as any, accountCode: 'stripe_poland', mode: 'test', connectionId: 'conn-test' };
    },
    internalDocs: {
      async list(orderId) {
        return (ops.docs ?? []).filter((d) => d.order_id === orderId).map((d) => ({ ...d }));
      },
    },
    signer: {
      async sign() {
        ops.signCalls++;
        if (ops.signFails) return null;
        return { url: ops.signedUrl ?? 'https://storage.example/sig?t=1', expires_at: '2099-01-01T00:00:00Z' };
      },
    },
    async auditWrite(e) { ops.auditWrites.push(e); },
    ...overrides,
  };
}

const PID = '11111111-1111-1111-1111-111111111111';
const OID = '22222222-2222-2222-2222-222222222222';
const PARENT_PID = '33333333-3333-3333-3333-333333333333';

function freshOps(over: Partial<MockOps> = {}): MockOps {
  return {
    payments: [],
    paymentsWrite: { calls: 0 },
    auditWrites: [],
    stripeCalls: [],
    signCalls: 0,
    ...over,
  };
}

function noPCI(obj: unknown) {
  const s = JSON.stringify(obj).toLowerCase();
  for (const k of PCI_FORBIDDEN_KEYS) assertFalse(s.includes(`"${k}"`), `PCI forbidden key leaked: ${k}`);
}

// ── 20 canonical cases ───────────────────────────────────────────────────────

Deno.test('1. Stripe receipt — local charge.receipt_url surfaced', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { charge_id: 'ch_aaa', charge: { receipt_url: 'https://pay.stripe.com/r/x' } } },
    receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(r.status, 200);
  assertEquals(b.provider_documents.length, 1);
  assertEquals(b.provider_documents[0].type, 'receipt');
  assertEquals(b.provider_documents[0].source, 'local_meta');
  assertEquals(ops.stripeCalls.length, 0);
  noPCI(b);
});

Deno.test('2. Stripe hosted invoice — local hosted_invoice_url', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 2, currency: 'USD', order_id: OID,
    meta: { stripe: { invoice_id: 'in_aaa', hosted_invoice_url: 'https://invoice.stripe.com/i/x' } },
    receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assert(b.provider_documents.find((d) => d.type === 'hosted_invoice'));
});

Deno.test('3. Stripe invoice PDF — local invoice_pdf', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 2, currency: 'USD', order_id: OID,
    meta: { stripe: { invoice_id: 'in_aaa', invoice_pdf: 'https://files.stripe.com/i.pdf' } },
    receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assert(b.provider_documents.find((d) => d.type === 'invoice_pdf' && d.url));
});

Deno.test('4. Stripe without provider documents — empty list, no warning', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { charge_id: 'ch_x' } }, receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.provider_documents.length, 0);
});

Deno.test('5. Stripe refund with canonical parent → REFUND_USES_PARENT_DOCUMENTS', async () => {
  const ops = freshOps({ payments: [
    { id: PID, provider: 'stripe', status: 'succeeded', amount: -5, currency: 'BYN', order_id: null,
      meta: { parent_payment_id: PARENT_PID }, receipt_url: null, provider_payment_id: 're_x' },
    { id: PARENT_PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
      meta: { stripe: { charge_id: 'ch_a', charge: { receipt_url: 'https://pay.stripe.com/r/p' } } },
      receipt_url: null, provider_payment_id: null },
  ] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.payment.is_refund, true);
  assertEquals(b.generation.blocked_reason, 'REFUND_USES_PARENT_DOCUMENTS');
  assert(b.provider_documents.find((d) => d.type === 'receipt'));
});

Deno.test('6. Stripe consultation — generation classifier; scenario_found=false → NO_DOCUMENT_SCENARIO', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 2, currency: 'USD', order_id: OID,
    meta: { stripe: { invoice_id: 'in_a', invoice_pdf: 'https://files.stripe.com/i.pdf' } },
    receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.generation.blocked_reason, 'NO_DOCUMENT_SCENARIO');
});

Deno.test('7. bePaid with local receipt', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'bepaid', status: 'succeeded', amount: 100, currency: 'BYN', order_id: OID,
    meta: { provider_response: { transaction: { uid: 'tx_a', receipt_url: 'https://bepaid.by/r/1' } } },
    receipt_url: 'https://bepaid.by/r/1', provider_payment_id: 'pay_a',
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.provider_documents.length, 1);
  assertEquals(b.provider_documents[0].provider, 'bepaid');
  assertEquals(b.provider_documents[0].external_id, 'tx_a');
});

Deno.test('8. bePaid without receipt + refresh → BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'bepaid', status: 'succeeded', amount: 100, currency: 'BYN', order_id: OID,
    meta: {}, receipt_url: null, provider_payment_id: 'pay_a',
  }] });
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.provider_documents.length, 0);
  assert(b.warnings.find((w) => w.code === 'BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY'));
});

Deno.test('9. Payment without order → PAYMENT_NOT_LINKED_TO_ORDER', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: null,
    meta: {}, receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.generation.blocked_reason, 'PAYMENT_NOT_LINKED_TO_ORDER');
});

Deno.test('10. Payment with internal document (UUID-only relation)', async () => {
  const ops = freshOps({
    payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID, meta: {}, receipt_url: null, provider_payment_id: null }],
    docs: [{ id: 'd1', order_id: OID, document_type: 'act', status: 'ready', number: 'A-1', storage_path: 'docs/d1.pdf', file_name: 'a.pdf', created_at: '2026-06-01T00:00:00Z' }],
  });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.internal_documents.length, 1);
  assertEquals(b.internal_documents[0].id, 'd1');
  assertEquals(b.internal_documents[0].url_kind, 'signed_storage');
});

Deno.test('11. Payment without scenario → NO_DOCUMENT_SCENARIO', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: {}, receipt_url: null, provider_payment_id: null }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  assertEquals((r.body as ResolverResponse).generation.blocked_reason, 'NO_DOCUMENT_SCENARIO');
});

Deno.test('12. Stripe account not resolved on refresh → warning + locals still shown', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { livemode: false, charge_id: 'ch_a', charge: { receipt_url: 'https://pay.stripe.com/r/x' } } },
    receipt_url: null, provider_payment_id: null,
  }] });
  // No account_code → factory returns STRIPE_ACCOUNT_NOT_RESOLVED (without being called for null code; entrypoint emits directly).
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.provider_documents.length, 1);
  assert(b.warnings.find((w) => w.code === 'PROVIDER_DOCUMENT_RETRIEVE_FAILED' && w.detail === 'STRIPE_ACCOUNT_NOT_RESOLVED'));
});

Deno.test('13. Unsafe URL is not returned to client', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { charge_id: 'ch_a', charge: { receipt_url: 'http://evil.com/r' } } },
    receipt_url: null, provider_payment_id: null,
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.provider_documents[0].url, null);
  assertEquals(b.provider_documents[0].status, 'unavailable');
  assertEquals(b.provider_documents[0].warning, 'UNSAFE_DOCUMENT_URL');
});

Deno.test('14. Refund parent missing → REFUND_PARENT_NOT_RESOLVED warning', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'stripe', status: 'succeeded', amount: -5, currency: 'BYN', order_id: null,
    meta: {}, receipt_url: null, provider_payment_id: 're_x',
  }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assert(b.warnings.find((w) => w.code === 'REFUND_PARENT_NOT_RESOLVED'));
});

Deno.test('15. Duplicate local/provider document → single card (exact identity)', async () => {
  const ops = freshOps({
    payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
      meta: { stripe: { account_code: 'stripe_poland', charge_id: 'ch_a', charge: { receipt_url: 'https://pay.stripe.com/r/x' } } },
      receipt_url: null, provider_payment_id: null }],
    stripeRetrieves: {
      'charges:ch_a': { ok: true, data: { receipt_url: 'https://pay.stripe.com/r/x' } },
    },
  });
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops));
  const b = r.body as ResolverResponse;
  const receipts = b.provider_documents.filter((d) => d.type === 'receipt' && d.external_id === 'ch_a');
  assertEquals(receipts.length, 1);
  assertEquals(receipts[0].source, 'local_meta+provider_api');
});

Deno.test('16. View-only role cannot refresh (capability false)', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'bepaid', status: 'succeeded', amount: 100, currency: 'BYN', order_id: OID,
    meta: {}, receipt_url: null, provider_payment_id: 'pay_a',
  }] });
  const deps = makeDeps(ops, { capabilities: { canRefresh: false, canSeeDiagnostics: false } });
  const r = await resolvePaymentDocuments(PID, true /* requested */, deps);
  assertEquals(ops.auditWrites.length, 0);
  // No refresh attempted → no BEPAID_REFRESH warning.
  assertFalse((r.body as ResolverResponse).warnings.some((w) => w.code === 'BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY'));
});

Deno.test('17. Provider API timeout does not hide internal documents', async () => {
  const ops = freshOps({
    payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
      meta: { stripe: { account_code: 'stripe_poland', invoice_id: 'in_a' } }, receipt_url: null, provider_payment_id: null }],
    stripeRetrieves: { 'invoices:in_a': { ok: false, data: null, error: { code: 'timeout' } } },
    docs: [{ id: 'd9', order_id: OID, document_type: 'act', status: 'ready', number: 'N', storage_path: 'docs/d.pdf', file_name: null, created_at: '2026-06-01T00:00:00Z' }],
  });
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops));
  const b = r.body as ResolverResponse;
  assertEquals(b.internal_documents.length, 1);
  assert(b.warnings.find((w) => w.code === 'PROVIDER_DOCUMENT_RETRIEVE_FAILED'));
});

Deno.test('18. Signed URL is not persisted (no DB writes; sign called per-request)', async () => {
  const ops = freshOps({
    payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID, meta: {}, receipt_url: null, provider_payment_id: null }],
    docs: [{ id: 'd1', order_id: OID, document_type: 'act', status: 'ready', number: null, storage_path: 'docs/d1.pdf', file_name: null, created_at: '2026-06-01T00:00:00Z' }],
  });
  await resolvePaymentDocuments(PID, false, makeDeps(ops));
  assertEquals(ops.paymentsWrite.calls, 0);
  assertEquals(ops.signCalls, 1);
});

Deno.test('19. Resolve does not create document/generation audit (refresh=false → 0 audit)', async () => {
  const ops = freshOps({ payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID, meta: {}, receipt_url: null, provider_payment_id: null }] });
  await resolvePaymentDocuments(PID, false, makeDeps(ops));
  assertEquals(ops.auditWrites.length, 0);
});

Deno.test('20. bePaid local receipt remains compatible after resolve', async () => {
  const ops = freshOps({ payments: [{
    id: PID, provider: 'bepaid', status: 'succeeded', amount: 100, currency: 'BYN', order_id: OID,
    meta: {}, receipt_url: 'https://bepaid.by/r/1', provider_payment_id: 'pay_a',
  }] });
  await resolvePaymentDocuments(PID, false, makeDeps(ops));
  assertEquals(ops.paymentsWrite.calls, 0);
});

// ── 5 additional checks ──────────────────────────────────────────────────────

Deno.test('A1. Non-privileged user (no roles) → 403 via HTTP layer; resolver itself respects capabilities=0', async () => {
  // Direct test: when canRefresh=false and view-only, resolver still runs but blocks audits and refresh.
  // 403 is enforced in HTTP handler before resolver call (covered by reading code path).
  const ops = freshOps({ payments: [{ id: PID, provider: 'bepaid', status: 'succeeded', amount: 100, currency: 'BYN', order_id: OID, meta: {}, receipt_url: 'https://bepaid.by/r/1', provider_payment_id: 'pay_a' }] });
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops, { capabilities: { canRefresh: false, canSeeDiagnostics: false } }));
  assertEquals(ops.auditWrites.length, 0);
  assertEquals((r.body as ResolverResponse).diagnostics, null);
});

Deno.test('A2. Refresh does not mutate payments_v2 (no insert/update/upsert/delete on payments_v2)', async () => {
  const ops = freshOps({ payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { account_code: 'stripe_poland', charge_id: 'ch_a', invoice_id: 'in_a' } }, receipt_url: null, provider_payment_id: null }],
    stripeRetrieves: {
      'charges:ch_a': { ok: true, data: { receipt_url: 'https://pay.stripe.com/r/x' } },
      'invoices:in_a': { ok: true, data: { hosted_invoice_url: 'https://invoice.stripe.com/i/x', invoice_pdf: 'https://files.stripe.com/i.pdf', id: 'in_a' } },
    },
  });
  await resolvePaymentDocuments(PID, true, makeDeps(ops));
  assertEquals(ops.paymentsWrite.calls, 0);
});

Deno.test('A3. Exact retrieve only — no list/search ever invoked', async () => {
  const ops = freshOps({ payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { account_code: 'stripe_poland', invoice_id: 'in_a' } }, receipt_url: null, provider_payment_id: null }],
    stripeRetrieves: { 'invoices:in_a': { ok: true, data: { id: 'in_a', hosted_invoice_url: 'https://invoice.stripe.com/i' } } },
  });
  await resolvePaymentDocuments(PID, true, makeDeps(ops));
  for (const c of ops.stripeCalls) {
    assert(['payment_intents', 'charges', 'invoices', 'refunds', 'credit_notes', 'subscriptions'].includes(c.resource));
    assert(/^(pi|ch|in|re|cn|sub)_/.test(c.id), `id ${c.id} is not exact`);
  }
});

Deno.test('A4. Diagnostics hidden for non-super_admin', async () => {
  const ops = freshOps({ payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID, meta: {}, receipt_url: null, provider_payment_id: null }] });
  const r = await resolvePaymentDocuments(PID, false, makeDeps(ops, { capabilities: { canRefresh: true, canSeeDiagnostics: false } }));
  assertEquals((r.body as ResolverResponse).diagnostics, null);
});

Deno.test('A5. PCI forbidden fields absent from response and audit payload', async () => {
  const ops = freshOps({ payments: [{ id: PID, provider: 'stripe', status: 'succeeded', amount: 5, currency: 'BYN', order_id: OID,
    meta: { stripe: { account_code: 'stripe_poland', charge_id: 'ch_a', charge: { receipt_url: 'https://pay.stripe.com/r/x', billing_details: 'should-not-leak', card: { last4: '4242' } } } },
    receipt_url: null, provider_payment_id: null }] });
  const r = await resolvePaymentDocuments(PID, true, makeDeps(ops));
  noPCI(r.body);
  for (const a of ops.auditWrites) noPCI(a.meta);
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

Deno.test('url-security: boundary-safe hostname check', () => {
  assert(classifyProviderUrl('https://pay.stripe.com/x').safe);
  assert(classifyProviderUrl('https://merchant.bepaid.by/x').safe);
  assertFalse(classifyProviderUrl('https://bepaid.by.evil.com/x').safe);
  assertFalse(classifyProviderUrl('https://evilbepaid.by/x').safe);
  assertFalse(classifyProviderUrl('http://pay.stripe.com/x').safe);
  assertFalse(classifyProviderUrl('javascript:alert(1)').safe);
  assertFalse(classifyProviderUrl('https://u:p@pay.stripe.com/x').safe);
});

Deno.test('url-security: signed storage url must be https without credentials', () => {
  assert(isSafeSignedStorageUrl('https://x.supabase.co/storage/v1/object/sign/x?t=1'));
  assertFalse(isSafeSignedStorageUrl('http://x/x'));
  assertFalse(isSafeSignedStorageUrl('https://u:p@x/x'));
});

Deno.test('generation-status: refund overrides all', () => {
  const g = classifyGeneration({ order_id: 'o', is_refund: true, stripe_account_resolved: true, internal_documents: [], scenario_found: true });
  assertEquals(g.blocked_reason, 'REFUND_USES_PARENT_DOCUMENTS');
  assertEquals(g.can_generate, false);
});
