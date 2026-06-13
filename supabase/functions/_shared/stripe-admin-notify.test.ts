// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2 — pure decision helper tests.
// Runs under Deno test runner. No network, no Supabase, no Stripe SDK.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  resolveInvoiceNotifyDecision,
  orderedRefundCandidates,
  scanForbiddenKeys,
} from './stripe-admin-notify.ts';

// ---------- invoice.paid decision table ----------

Deno.test('invoice decision: subscription_cycle → notify', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_cycle', payment_id: 'p1' });
  assertEquals(d, { notify: true, reason: 'subscription_cycle' });
});

Deno.test('invoice decision: subscription_create → no notify (first charge already notified)', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_create', payment_id: 'p1' });
  assertEquals(d.notify, false);
  assertEquals(d.reason, 'subscription_create');
});

Deno.test('invoice decision: subscription_update → no notify', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_update', payment_id: 'p1' });
  assertEquals(d, { notify: false, reason: 'subscription_update' });
});

Deno.test('invoice decision: manual → no notify (no proven business rule)', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'manual', payment_id: 'p1' });
  assertEquals(d, { notify: false, reason: 'manual' });
});

Deno.test('invoice decision: null / unknown → no notify', () => {
  assertEquals(resolveInvoiceNotifyDecision({ billing_reason: null, payment_id: 'p1' }), { notify: false, reason: 'unknown' });
  assertEquals(resolveInvoiceNotifyDecision({ billing_reason: 'mystery', payment_id: 'p1' }), { notify: false, reason: 'unknown' });
});

Deno.test('invoice decision: resolver duplicate → no notify', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_cycle', payment_id: 'p1', resolver_note: 'invoice_paid_duplicate' });
  assertEquals(d, { notify: false, reason: 'duplicate_event' });
});

Deno.test('invoice decision: manual_review → no notify regardless of billing_reason', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_cycle', payment_id: 'p1', manual_review: true });
  assertEquals(d, { notify: false, reason: 'manual_review' });
});

Deno.test('invoice decision: missing payment_id → no notify', () => {
  const d = resolveInvoiceNotifyDecision({ billing_reason: 'subscription_cycle', payment_id: null });
  assertEquals(d, { notify: false, reason: 'missing_payment_id' });
});

// ---------- refund ordering / dedup ----------

Deno.test('refund order: stable ascending by created, ties by id', () => {
  const ordered = orderedRefundCandidates([
    { id: 're_2', amount: 100, currency: 'usd', created: 200 },
    { id: 're_1', amount: 100, currency: 'usd', created: 100 },
    { id: 're_3', amount: 100, currency: 'usd', created: 200 },
  ]);
  assertEquals(ordered.map(r => r.id), ['re_1', 're_2', 're_3']);
});

Deno.test('refund order: deduplicates by id', () => {
  const ordered = orderedRefundCandidates([
    { id: 're_1', amount: 100, currency: 'usd', created: 100 },
    { id: 're_1', amount: 100, currency: 'usd', created: 100 },
    { id: 're_2', amount: 100, currency: 'usd', created: 200 },
  ]);
  assertEquals(ordered.length, 2);
  assertEquals(ordered.map(r => r.id), ['re_1', 're_2']);
});

Deno.test('refund order: handles missing created (treat as 0)', () => {
  const ordered = orderedRefundCandidates([
    { id: 're_b', amount: 1, currency: 'usd', created: 10 },
    { id: 're_a', amount: 1, currency: 'usd' },
  ]);
  assertEquals(ordered.map(r => r.id), ['re_a', 're_b']);
});

// ---------- payload safety ----------

Deno.test('payload safety: detects card / cvc / customer / receipt_url at any depth', () => {
  const obj = { message: 'ok', meta: { stripe: { customer: 'cus_X', card: { pan: '4242' } } } };
  const hits = scanForbiddenKeys(obj);
  // Should detect at least: customer, card, pan (not in the canonical allowlist but listed)
  assertEquals(hits.includes('customer'), true);
  assertEquals(hits.includes('card'), true);
  assertEquals(hits.includes('pan'), true);
});

Deno.test('payload safety: safe payload returns no hits', () => {
  const obj = {
    message: '<b>Stripe (оплата)</b>',
    parse_mode: 'HTML',
    source: 'stripe_webhook:payment_succeeded',
    order_id: 'ord-1',
    payment_id: 'pay-1',
  };
  assertEquals(scanForbiddenKeys(obj), []);
});

Deno.test('payload safety: detects receipt_url and client_secret', () => {
  const obj = { extra: { receipt_url: 'https://stripe.com/r/x', client_secret: 'sec_x' } };
  const hits = scanForbiddenKeys(obj);
  assertEquals(hits.sort(), ['client_secret', 'receipt_url']);
});
