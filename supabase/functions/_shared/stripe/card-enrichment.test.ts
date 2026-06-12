// ============================================================================
// PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A
// Unit tests for _shared/stripe/card-extract.ts and card-enrichment.ts.
//
// Run: deno test --allow-all supabase/functions/_shared/stripe/card-enrichment.test.ts
// ============================================================================

import { assert, assertEquals, assertFalse, assertRejects, assertThrows }
  from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  assertNoPciFields,
  extractCardFromCharge,
} from './card-extract.ts';

import {
  buildSanitizedCardSnapshot,
  enrichStripePaymentCardData,
  isCardSnapshotComplete,
  persistStripeCardSnapshot,
  resolvePaymentIntentFromRow,
} from './card-enrichment.ts';

// =============================================================================
// In-memory Supabase mock
// =============================================================================

interface FakeRow extends Record<string, any> { id: string; }

function makeSupabaseMock(initialRows: Record<string, FakeRow[]>) {
  const tables: Record<string, FakeRow[]> = JSON.parse(JSON.stringify(initialRows));
  const audit: Array<Record<string, any>> = [];
  tables['audit_logs'] = tables['audit_logs'] ?? [];

  function from(table: string) {
    const ctx: any = {
      _table: table,
      _filters: [] as Array<(r: FakeRow) => boolean>,
      _select: '*',
      _wantCount: false,
      _wantHead: false,
      _action: 'select' as 'select' | 'insert' | 'update',
      _updatePayload: null as any,
      _insertPayload: null as any,
      _maybeSingle: false,
      _single: false,
      _limit: null as number | null,
      _likePatterns: [] as Array<{ col: string; pat: string }>,
    };
    ctx.select = (cols: string, opts?: any) => {
      ctx._select = cols;
      if (opts?.count === 'exact') ctx._wantCount = true;
      if (opts?.head === true) ctx._wantHead = true;
      return ctx;
    };
    ctx.eq = (col: string, val: any) => {
      ctx._filters.push((r: FakeRow) => r[col] === val);
      return ctx;
    };
    ctx.gt = (col: string, val: any) => {
      ctx._filters.push((r: FakeRow) => Number(r[col]) > Number(val));
      return ctx;
    };
    ctx.like = (col: string, pat: string) => {
      const prefix = pat.replace(/%$/, '');
      ctx._filters.push((r: FakeRow) => typeof r[col] === 'string' && r[col].startsWith(prefix));
      return ctx;
    };
    ctx.limit = (n: number) => { ctx._limit = n; return ctx; };
    ctx.maybeSingle = () => { ctx._maybeSingle = true; return run(); };
    ctx.single = () => { ctx._single = true; return run(); };
    ctx.insert = (payload: any) => { ctx._action = 'insert'; ctx._insertPayload = payload; return run(); };
    ctx.update = (payload: any) => { ctx._action = 'update'; ctx._updatePayload = payload; return ctx; };
    // thenable: support `await from(...).update(...).eq(...)` chain that resolves on update.
    ctx.then = (resolve: any, reject: any) => run().then(resolve, reject);

    async function run() {
      const rows = (tables[ctx._table] ?? []).filter((r) => ctx._filters.every((f: any) => f(r)));
      if (ctx._action === 'insert') {
        const arr = Array.isArray(ctx._insertPayload) ? ctx._insertPayload : [ctx._insertPayload];
        for (const p of arr) {
          const row = { ...p, id: p.id ?? crypto.randomUUID() };
          (tables[ctx._table] ?? (tables[ctx._table] = [])).push(row);
          if (ctx._table === 'audit_logs') audit.push(row);
        }
        return { data: arr[0], error: null };
      }
      if (ctx._action === 'update') {
        for (const r of rows) Object.assign(r, ctx._updatePayload);
        return { data: rows, error: null };
      }
      // select
      if (ctx._wantCount) {
        return { data: null, count: rows.length, error: null };
      }
      if (ctx._maybeSingle) return { data: rows[0] ?? null, error: null };
      if (ctx._single) {
        if (!rows[0]) return { data: null, error: { message: 'not_found' } };
        return { data: rows[0], error: null };
      }
      const slice = ctx._limit ? rows.slice(0, ctx._limit) : rows;
      return { data: slice, error: null };
    }
    return ctx;
  }
  return { from, _tables: tables, _audit: audit };
}

// =============================================================================
// card-extract tests
// =============================================================================

Deno.test('extract: raw input with exp_month/exp_year/fingerprint does NOT throw', () => {
  const rawCharge = {
    id: 'ch_test1',
    payment_method: 'pm_test1',
    billing_details: { name: 'Ivan Petrov' },
    payment_method_details: {
      type: 'card',
      card: {
        brand: 'visa',
        last4: '4242',
        funding: 'credit',
        country: 'PL',
        // forbidden raw fields from real Stripe payload:
        exp_month: 12,
        exp_year: 2030,
        fingerprint: 'fp_abc',
        wallet: { type: 'apple_pay' },
      },
    },
  };
  const r = extractCardFromCharge(rawCharge);
  assertEquals(r.hasAnyData, true);
  assertEquals(r.card_brand, 'visa');
  assertEquals(r.card_last4, '4242');
  assertEquals(r.card_holder, 'Ivan Petrov');
  assertEquals(r.payment_method_id, 'pm_test1');
  assertEquals(r.charge_id, 'ch_test1');
  assert(r.snapshot);
  assertEquals(r.snapshot.card.wallet?.type, 'apple_pay');
  // Output MUST NOT contain forbidden keys.
  const s = JSON.stringify(r.snapshot);
  for (const k of ['exp_month', 'exp_year', 'fingerprint', 'number', 'pan', 'cvc', 'cvv']) {
    assertFalse(s.includes(`"${k}"`), `forbidden key "${k}" leaked into snapshot`);
  }
});

Deno.test('extract: charge without card returns empty', () => {
  const r = extractCardFromCharge({ id: 'ch_x', payment_method: 'pm_x', billing_details: null });
  assertEquals(r.snapshot, null);
  assertEquals(r.card_brand, null);
  // payment_method_id / charge_id still surfaced for meta even without card.
  assertEquals(r.payment_method_id, 'pm_x');
  assertEquals(r.charge_id, 'ch_x');
});

Deno.test('extract: null/undefined safe', () => {
  assertEquals(extractCardFromCharge(null).hasAnyData, false);
  assertEquals(extractCardFromCharge(undefined).hasAnyData, false);
  assertEquals(extractCardFromCharge('not-an-object' as any).hasAnyData, false);
});

Deno.test('assertNoPciFields: throws on synthetic leak in output', () => {
  // Synthetic injection that bypasses the whitelist — defensive scan must catch it.
  const leaked = { type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12 } };
  assertThrows(() => assertNoPciFields(leaked, 'test'), Error, 'pci_violation');
});

Deno.test('assertNoPciFields: deep scan finds nested forbidden key', () => {
  const leaked = { meta: { stripe: { payment_method_details: { card: { number: '4242' } } } } };
  assertThrows(() => assertNoPciFields(leaked, 'deep'), Error, 'pci_violation');
});

Deno.test('assertNoPciFields: clean payload passes', () => {
  const clean = { meta: { stripe: { payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } } } };
  assertNoPciFields(clean, 'clean');
});

// =============================================================================
// PI resolver tests
// =============================================================================

Deno.test('resolvePI: single source wins', () => {
  const r = resolvePaymentIntentFromRow({
    id: 'p1', provider: 'stripe', amount: 10,
    provider_payment_id: 'pi_aaa',
    meta: { stripe: { payment_intent_id: 'pi_aaa' } },
  });
  assert(r.ok && r.payment_intent_id === 'pi_aaa');
});

Deno.test('resolvePI: conflicting sources STOP', () => {
  const r = resolvePaymentIntentFromRow({
    id: 'p1', provider: 'stripe', amount: 10,
    provider_payment_id: 'pi_aaa',
    meta: { stripe: { payment_intent_id: 'pi_bbb' } },
  });
  assert(!r.ok && r.reason === 'conflicting_payment_intent_ids');
});

Deno.test('resolvePI: no PI anywhere', () => {
  const r = resolvePaymentIntentFromRow({
    id: 'p1', provider: 'stripe', amount: 10,
    provider_payment_id: 'ch_xxx',
    meta: {},
  });
  assert(!r.ok && r.reason === 'no_payment_intent');
});

// =============================================================================
// Completeness predicate
// =============================================================================

Deno.test('isCardSnapshotComplete: all pieces required', () => {
  assertFalse(isCardSnapshotComplete({ card_brand: null, card_last4: null, meta: null }));
  assertFalse(isCardSnapshotComplete({
    card_brand: 'visa', card_last4: '4242',
    meta: { stripe: { payment_method_id: 'pm_x', charge_id: 'ch_x' } },
  }));
  assert(isCardSnapshotComplete({
    card_brand: 'visa', card_last4: '4242',
    meta: { stripe: {
      payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
      payment_method_id: 'pm_x',
      charge_id: 'ch_x',
    } },
  }));
});

// =============================================================================
// Writer (enrichStripePaymentCardData) end-to-end with in-memory supabase
// =============================================================================

const baseCharge = {
  id: 'ch_test',
  payment_method: 'pm_test',
  billing_details: { name: 'Anna' },
  payment_method_details: {
    type: 'card',
    card: { brand: 'visa', last4: '4242', funding: 'credit', country: 'PL',
            exp_month: 1, exp_year: 2030, fingerprint: 'fp' },
  },
};

Deno.test('enrich: positive stripe row → updated', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: { stripe: { account_code: 'stripe_poland' } },
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'updated');
  const row = sb._tables['payments_v2'][0];
  assertEquals(row.card_brand, 'visa');
  assertEquals(row.card_last4, '4242');
  assertEquals(row.card_holder, 'Anna');
  assertEquals(row.meta.stripe.payment_method_id, 'pm_test');
  assertEquals(row.meta.stripe.charge_id, 'ch_test');
  assertEquals(row.meta.stripe.payment_method_details.card.brand, 'visa');
  // forbidden keys never persisted:
  const s = JSON.stringify(row);
  for (const k of ['exp_month', 'exp_year', 'fingerprint', 'number', 'cvc']) {
    assertFalse(s.includes(`"${k}"`));
  }
});

Deno.test('enrich: refund (amount<0) → invalid, no update', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: -2,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: {},
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'invalid');
  assertEquals(sb._tables['payments_v2'][0].card_brand, null);
});

Deno.test('enrich: bepaid row → invalid', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'bepaid', amount: 10,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: {},
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'invalid');
});

Deno.test('enrich: complete snapshot → skipped_complete', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test',
      card_brand: 'visa', card_last4: '4242', card_holder: 'Anna',
      meta: { stripe: {
        account_code: 'stripe_poland',
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
        payment_method_id: 'pm_test',
        charge_id: 'ch_test',
      } },
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'skipped_complete');
});

Deno.test('enrich: ambiguous (2 positive rows per PI) → ambiguous', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [
      { id: 'p1', provider: 'stripe', amount: 2, provider_payment_id: 'pi_test',
        card_brand: null, card_last4: null, card_holder: null, meta: {} },
      { id: 'p2', provider: 'stripe', amount: 5, provider_payment_id: 'pi_test',
        card_brand: null, card_last4: null, card_holder: null, meta: {} },
    ],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'ambiguous');
});

Deno.test('enrich: account_code mismatch → invalid', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: { stripe: { account_code: 'stripe_other' } },
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'invalid');
});

Deno.test('enrich: invalid PI format → invalid (no DB write)', async () => {
  const sb = makeSupabaseMock({ payments_v2: [] });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'ch_oops',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: baseCharge,
  });
  assertEquals(res.verdict, 'invalid');
});

Deno.test('enrich: no charge data → no_data', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: {},
    }],
  });
  const res = await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'targeted_fetch',
    actor: { type: 'user', user_id: 'u1', label: 'test' },
    preloadedCharge: { id: null, payment_method_details: null, billing_details: null },
  });
  assertEquals(res.verdict, 'no_data');
});

Deno.test('enrich: wallet NOT overwritten by event without wallet', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test',
      card_brand: 'visa', card_last4: '4242', card_holder: null,
      meta: { stripe: {
        account_code: 'stripe_poland',
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: { type: 'apple_pay' } } },
        payment_method_id: 'pm_test',
      } },
    }],
  });
  // New event has no wallet — must NOT erase apple_pay.
  const chargeNoWallet = {
    id: 'ch_test', payment_method: 'pm_test', billing_details: { name: 'Anna' },
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
  };
  await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'invoice.paid',
    actor: { type: 'system', label: 'test' },
    preloadedCharge: chargeNoWallet,
  });
  const row = sb._tables['payments_v2'][0];
  assertEquals(row.meta.stripe.payment_method_details.card.wallet.type, 'apple_pay');
});

Deno.test('enrich: sources_seen dedup', async () => {
  const sb = makeSupabaseMock({
    payments_v2: [{ id: 'p1', provider: 'stripe', amount: 2,
      provider_payment_id: 'pi_test', card_brand: null, card_last4: null, card_holder: null,
      meta: { stripe: { account_code: 'stripe_poland' } },
    }],
  });
  await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'checkout.session.completed',
    actor: { type: 'system', label: 'test' }, preloadedCharge: baseCharge,
  });
  // Force a second update by changing brand: simulate fresh fingerprintless event
  // (existing snapshot stays complete? — manually clear charge_id to force update path)
  const row = sb._tables['payments_v2'][0];
  delete row.meta.stripe.charge_id;
  await enrichStripePaymentCardData({
    supabase: sb as any, paymentId: 'p1', paymentIntentId: 'pi_test',
    accountCode: 'stripe_poland', source: 'payment_intent.succeeded',
    actor: { type: 'system', label: 'test' }, preloadedCharge: baseCharge,
    forceRefresh: true,
  });
  const seen = sb._tables['payments_v2'][0].meta.stripe.card_data_sources_seen;
  assertEquals(seen.sort(), ['checkout.session.completed', 'payment_intent.succeeded']);
});
