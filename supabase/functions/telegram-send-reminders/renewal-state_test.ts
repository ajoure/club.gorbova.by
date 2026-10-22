import { classifyRenewalState, resolveRenewalState } from './renewal-state.ts';

const now = Date.parse('2030-01-01T00:00:00Z');
const end = '2030-01-04T12:00:00Z';
function fixture() {
  return {
    userId: 'user-a', productId: 'product-a', activeUntil: end, now,
    subscriptions: [{ id: 'paid-sub', user_id: 'user-a', product_id: 'product-a', order_id: 'paid-order',
      tariff_id: 'tariff-a', status: 'active', auto_renew: false, billing_type: 'mit', access_end_at: end,
      meta: {} as Record<string, any> }],
    providers: [] as Array<{ subscription_v2_id: string | null; user_id: string | null;
      order_id: string | null; state: string; next_charge_at: string | null }>,
    orders: [{ id: 'paid-order', user_id: 'user-a', product_id: 'product-a', status: 'paid', is_deleted: false }],
  };
}
function automatic() {
  const f = fixture();
  Object.assign(f.subscriptions[0], { auto_renew: true, billing_type: 'provider_managed' });
  f.providers.push({ subscription_v2_id: 'paid-sub', user_id: 'user-a', order_id: 'paid-order',
    state: 'active', next_charge_at: '2030-01-04T10:00:00Z' });
  return f;
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

Deno.test('unpaid newer provider draft never overrides a paid one-time period', () => {
  const f = fixture();
  f.subscriptions.unshift({ ...f.subscriptions[0], id: 'draft-sub', order_id: 'draft-order',
    status: 'past_due', auto_renew: true, billing_type: 'provider_managed' });
  f.orders.push({ ...f.orders[0], id: 'draft-order', status: 'pending' });
  f.providers.push({ subscription_v2_id: 'draft-sub', user_id: 'user-a', order_id: 'draft-order', state: 'expired', next_charge_at: null });
  equal(classifyRenewalState(f), { mode: 'manual', reason: 'no_active_provider', subscriptionId: 'paid-sub', tariffId: 'tariff-a' });
});
Deno.test('automatic status and schedule refer to the same paid provider relationship', () => {
  const result = classifyRenewalState(automatic());
  equal(result.mode, 'automatic');
  equal(result.nextChargeAt, '2030-01-04T10:00:00Z');
});
Deno.test('unrelated product provider never supplies a date or automatic claim', () => {
  const f = fixture();
  f.providers.push({ subscription_v2_id: 'other-product-sub', user_id: 'user-a', order_id: 'other-order', state: 'active', next_charge_at: end });
  equal(classifyRenewalState(f).mode, 'manual');
  equal(classifyRenewalState(f).nextChargeAt, undefined);
});
for (const state of ['canceled', 'expired']) {
  Deno.test(`${state} provider cannot promise auto-renewal`, () => {
    const f = automatic(); f.providers[0].state = state;
    equal(classifyRenewalState(f).mode, 'skip');
  });
}
for (const state of ['past_due', 'failed_attempt']) {
  Deno.test(`${state} provider suppresses both automatic promise and duplicate checkout`, () => {
    const f = automatic(); f.providers[0].state = state;
    equal(classifyRenewalState(f).reason, 'provider_retrying');
  });
}
Deno.test('finite installment with auto_renew=false suppresses renewal without changing mandate', () => {
  const f = automatic(); f.subscriptions[0].auto_renew = false;
  f.subscriptions[0].meta = { installment: { as_finite_subscription: true } };
  equal(classifyRenewalState(f).reason, 'finite_installment');
});
Deno.test('ordinary disabled local flag with live provider is a conflict, never manual checkout', () => {
  const f = automatic(); f.subscriptions[0].auto_renew = false;
  equal(classifyRenewalState(f).reason, 'local_provider_conflict');
});
Deno.test('provider user and order mismatch fail closed', () => {
  const f = automatic(); f.providers[0].user_id = 'other-user';
  equal(classifyRenewalState(f).mode, 'skip');
  f.providers[0].user_id = 'user-a'; f.providers[0].order_id = 'wrong-order';
  equal(classifyRenewalState(f).mode, 'skip');
});
Deno.test('unlinked active provider blocks checkout', () => {
  const f = fixture(); f.providers.push({ user_id: 'user-a', subscription_v2_id: null, order_id: null, state: 'active', next_charge_at: end });
  equal(classifyRenewalState(f).mode, 'skip');
});
for (const next of [null, 'invalid', '2029-12-31T12:00:00Z']) {
  Deno.test(`missing or stale provider date (${next}) never falls back to access end`, () => {
    const f = automatic(); f.providers[0].next_charge_at = next;
    equal(classifyRenewalState(f).reason, 'provider_schedule_unknown');
  });
}
Deno.test('multiple paid periods or providers are ambiguous', () => {
  const f = automatic(); f.subscriptions.push({ ...f.subscriptions[0], id: 'second-sub' });
  equal(classifyRenewalState(f).reason, 'ambiguous_paid_period');
  f.subscriptions.pop(); f.providers.push({ ...f.providers[0] });
  equal(classifyRenewalState(f).reason, 'ambiguous_provider');
});
Deno.test('extended and lifetime access suppress stale expiry reminder', () => {
  const f = fixture(); f.subscriptions[0].access_end_at = '2030-02-01T00:00:00Z';
  equal(classifyRenewalState(f).reason, 'access_extended');
});
for (const status of ['pending', 'refunded', 'partial_refund', 'canceled']) {
  Deno.test(`order ${status} is not proof of paid period`, () => {
    const f = fixture(); f.orders[0].status = status;
    equal(classifyRenewalState(f).reason, 'no_paid_period');
  });
}

Deno.test('database failures never become a positive automatic or manual decision', async () => {
  for (const failure of ['subscriptions_v2', 'orders_v2', 'provider_subscriptions']) {
    const f = automatic();
    const tables: Record<string, unknown[]> = { subscriptions_v2: f.subscriptions, orders_v2: f.orders, provider_subscriptions: f.providers };
    // This mock supports only reads. Any accidental mutation throws.
    const db = { from(table: string) {
      const result = { data: failure === table ? null : tables[table], error: failure === table ? { code: 'test_failure' } : null };
      const q = { select() { return q; }, eq() { return q; }, or() { return q; }, in() { return q; }, limit() { return q; },
        then(resolve: (r: unknown) => unknown) { return Promise.resolve(resolve(result)); } };
      return q;
    } };
    equal((await resolveRenewalState(db, 'user-a', 'product-a', end, now)).mode, 'skip');
  }
});

// Execute the real HTTP handler with injected boundaries; no SDK/network or Telegram.
// Reading the handler source avoids starting a listener via Deno.serve in a unit test.
async function handlerHarness(allowed = true) {
  const source = (await Deno.readTextFile(new URL('./index.ts', import.meta.url)))
    .replace(/^import .*;\n/gm, '')
    .replace('Deno.serve(', 'return (');
  const module = await import('data:application/typescript,' + encodeURIComponent(
    `type RenewalState = any; export function createHandler(deps: any) {
      const { Deno, createClient, requireAdminSectionAccess, resolveRenewalState,
        resolveProductRenewability, generateRenewalCTAs, greetPrefix,
        logAutomatedTelegramMessage, formatMinskDateTime } = deps;
      ${source}\n}`));
  const f = fixture();
  let reads = 0;
  const tables: Record<string, unknown> = {
    telegram_access: [{ user_id: 'user-a', club_id: 'club-a', active_until: end }],
    products_v2: { id: 'product-a', name: 'Test Club' },
    subscriptions_v2: f.subscriptions, orders_v2: f.orders, provider_subscriptions: f.providers,
  };
  const db = { from(table: string) {
    reads++;
    if (!(table in tables)) throw new Error('unexpected table ' + table);
    const result = { data: tables[table], error: null };
    const q = { select(fields: string) {
      if (/token|telegram_bots/.test(fields)) throw new Error('dry-run read a secret');
      return q;
    }, eq() { return q; }, or() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; },
      limit() { return q; }, maybeSingle() { return q; },
      then(resolve: (r: unknown) => unknown) { return Promise.resolve(resolve(result)); } };
    return q;
  } };
  const forbidden = () => { throw new Error('side effect attempted'); };
  return { reads: () => reads, handler: module.createHandler({
    Deno: { env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test-service-only' : 'https://test.invalid' } },
    createClient: () => db, requireAdminSectionAccess: () => allowed ? { ok: true } : { ok: false, status: 403, error: 'forbidden' },
    resolveRenewalState, resolveProductRenewability: () => ({ renewable: true, reason: 'ok',
      preferredOffer: { tariff_id: 'tariff-a', amount: 100, kind: 'recurring' } }),
    generateRenewalCTAs: forbidden, greetPrefix: forbidden, logAutomatedTelegramMessage: forbidden,
    formatMinskDateTime: forbidden,
  }) };
}

Deno.test('actual dry-run handler reads state without tokens, checkout, writes or recipient output', async () => {
  const { handler } = await handlerHarness();
  const response = await handler(new Request('https://test.invalid', { method: 'POST',
    headers: { Authorization: 'Bearer test-admin' }, body: JSON.stringify({ dry_run: true }) }));
  equal(response.status, 200);
  const data = await response.json();
  equal(data.counts, { automatic: 0, manual: 1, one_time: 0, skipped: 0 });
  equal(data.sent, 0); equal(data.writes, 0);
  if (/user-a|paid-sub|paid-order|club-a|tariff-a/.test(JSON.stringify(data))) throw new Error('identifiers leaked');
});
Deno.test('dry-run requires authenticated payments access before reading customer tables', async () => {
  const harness = await handlerHarness(false);
  const response = await harness.handler(new Request('https://test.invalid', { method: 'POST', body: '{"dry_run":true}' }));
  equal(response.status, 403); equal(harness.reads(), 0);
});
Deno.test('mistyped dry_run cannot fall through to sending', async () => {
  for (const body of ['{"dry_run":"true"}', '{"order_id":"test"}', 'null', '[]', 'invalid']) {
    const harness = await handlerHarness();
    const response = await harness.handler(new Request('https://test.invalid', { method: 'POST', body }));
    equal(response.status, 400); equal(harness.reads(), 0);
  }
});
