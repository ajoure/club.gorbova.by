import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveReceiptForActor, type ReceiptResolverDeps } from './index.ts';
import type { StripeClientResolution } from '../_shared/payments/documents/stripe-client-factory.ts';

const PAYMENT_ID = '10000000-0000-4000-8000-000000000001';
const ORDER_ID = '20000000-0000-4000-8000-000000000002';
const USER_ID = '30000000-0000-4000-8000-000000000003';
const OLD_URL = 'https://pay.stripe.com/receipts/payment/expired';
const FRESH_URL = 'https://pay.stripe.com/receipts/payment/fresh';

function deps(overrides: Partial<ReceiptResolverDeps> = {}): ReceiptResolverDeps {
  const stripeClient: StripeClientResolution = {
    ok: true,
    accountCode: 'stripe_poland',
    mode: 'live',
    connectionId: '40000000-0000-4000-8000-000000000004',
    client: {
      async retrieve(resource, id) {
        if (resource === 'charges' && id === 'ch_fresh') {
          return { ok: true, status: 200, data: { id, receipt_url: FRESH_URL } };
        }
        return { ok: false, status: 404, data: null, error: { code: 'not_found' } };
      },
    },
  };
  return {
    async loadPayment() {
      return {
        id: PAYMENT_ID,
        provider: 'stripe',
        provider_payment_id: 'ch_fresh',
        status: 'succeeded',
        order_id: ORDER_ID,
        receipt_url: OLD_URL,
        meta: { stripe: { account_code: 'stripe_poland', livemode: true, charge_id: 'ch_fresh' } },
      };
    },
    async loadOrderOwner() { return USER_ID; },
    async buildStripeClient() { return stripeClient; },
    ...overrides,
  };
}

Deno.test('Stripe: returns freshly retrieved receipt, never the stored expired URL', async () => {
  const result = await resolveReceiptForActor(PAYMENT_ID, { userId: USER_ID, isStaff: false }, deps());
  assertEquals(result.status, 200);
  assertEquals(result.body.ok, true);
  if (result.body.ok) assertEquals(result.body.url, FRESH_URL);
});

Deno.test('Stripe: provider failure never falls back to the stored URL', async () => {
  const result = await resolveReceiptForActor(PAYMENT_ID, { userId: USER_ID, isStaff: true }, deps({
    async buildStripeClient() { return { ok: false, code: 'NETWORK_ERROR', retryable: true }; },
  }));
  assertEquals(result, {
    status: 502,
    body: { ok: false, error: 'STRIPE_RECEIPT_REFRESH_FAILED', retryable: true },
  });
});

Deno.test('Client owner can open own receipt; another client is forbidden', async () => {
  const result = await resolveReceiptForActor(PAYMENT_ID, {
    userId: '50000000-0000-4000-8000-000000000005',
    isStaff: false,
  }, deps());
  assertEquals(result.status, 403);
});

Deno.test('Stripe: exact provider_payment_id fallback supports old rows without meta charge_id', async () => {
  const base = deps();
  const result = await resolveReceiptForActor(PAYMENT_ID, { userId: USER_ID, isStaff: false }, {
    ...base,
    async loadPayment() {
      const payment = await base.loadPayment(PAYMENT_ID);
      return payment ? { ...payment, meta: { stripe: { account_code: 'stripe_poland', livemode: true } } } : null;
    },
  });
  assertEquals(result.status, 200);
});

Deno.test('Stripe: row without mode metadata delegates exact-account mode resolution to the client factory', async () => {
  const base = deps();
  let received: { accountCode: string | null; livemode: boolean | null; testMode: boolean | null } | null = null;
  const result = await resolveReceiptForActor(PAYMENT_ID, { userId: USER_ID, isStaff: true }, {
    ...base,
    async loadPayment() {
      const payment = await base.loadPayment(PAYMENT_ID);
      return payment ? {
        ...payment,
        meta: { stripe: { account_code: 'stripe_poland', charge_id: 'ch_fresh' } },
      } : null;
    },
    async buildStripeClient(args) {
      received = args;
      return base.buildStripeClient(args);
    },
  });
  assertEquals(result.status, 200);
  assertEquals(received, { accountCode: 'stripe_poland', livemode: null, testMode: null });
});

Deno.test('Unsuccessful payment cannot expose a receipt', async () => {
  const base = deps();
  const result = await resolveReceiptForActor(PAYMENT_ID, { userId: USER_ID, isStaff: true }, {
    ...base,
    async loadPayment() {
      const payment = await base.loadPayment(PAYMENT_ID);
      return payment ? { ...payment, status: 'pending' } : null;
    },
  });
  assertEquals(result.status, 409);
});
