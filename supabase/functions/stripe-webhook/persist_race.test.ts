// PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V2 — fix-to-patch.
// Concurrency proof for persistStripePaymentIfAbsent without live Stripe / live DB.
// Uses an in-memory mock supabase client that enforces UNIQUE (provider, provider_payment_id)
// the same way Postgres does (raises 23505 on the second insert).
//
// Invariants verified:
//   1) Two parallel calls with the same pi_* produce EXACTLY one row.
//   2) Exactly one call returns inserted=true; the other returns inserted=false.
//   3) Both return the SAME payment_id.
//   4) An unrelated 23505 (different column) is RE-THROWN, not masked as duplicate.

import { assertEquals, assert, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { persistStripePaymentIfAbsent } from './index.ts';

// ---------- in-memory mock supabase client ----------

interface Row { id: string; provider: string; provider_payment_id: string | null }

function makeMockClient(opts: { unrelatedUnique?: boolean } = {}) {
  const rows: Row[] = [];
  let nextId = 1;

  function from(table: string) {
    if (table !== 'payments_v2') throw new Error(`unexpected table ${table}`);
    return {
      insert(row: Record<string, unknown>) {
        const provider = String(row.provider);
        const pid = String(row.provider_payment_id ?? '');
        return {
          select(_cols: string) {
            return {
              async maybeSingle() {
                // Simulate unrelated unique constraint (e.g. order_id+kind) when asked.
                if (opts.unrelatedUnique) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_payments_v2_order_kind"' } };
                }
                // Atomic check-and-insert (Postgres-style).
                const dup = rows.find(r => r.provider === provider && r.provider_payment_id === pid);
                if (dup) {
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_payments_v2_provider_payment"' } };
                }
                const id = `pay_${nextId++}`;
                rows.push({ id, provider, provider_payment_id: pid });
                return { data: { id }, error: null };
              },
            };
          },
        };
      },
      select(_cols: string) {
        const filters: Array<{ k: string; v: unknown }> = [];
        const builder = {
          eq(k: string, v: unknown) { filters.push({ k, v }); return builder; },
          async maybeSingle() {
            const found = rows.find(r =>
              filters.every(f => (r as unknown as Record<string, unknown>)[f.k] === f.v),
            );
            return { data: found ? { id: found.id } : null, error: null };
          },
        };
        return builder;
      },
    };
  }

  return { from, _rows: () => rows };
}

// ---------- concurrency: two parallel writers, same pi_* ----------

Deno.test('persist race: 2 parallel writers → 1 row, 1 inserted=true, 1 inserted=false, same payment_id', async () => {
  const mock = makeMockClient();
  const pi = 'pi_RACE_001';
  const row = (source: string) => ({
    order_id: 'ord-1', user_id: 'u-1', profile_id: null,
    provider: 'stripe', provider_payment_id: pi,
    amount: 7, currency: 'USD', status: 'succeeded',
    paid_at: new Date().toISOString(),
    meta: { stripe: { source } },
  });

  // deno-lint-ignore no-explicit-any
  const [a, b] = await Promise.all([
    persistStripePaymentIfAbsent(mock as any, pi, row('checkout.session.completed')),
    persistStripePaymentIfAbsent(mock as any, pi, row('payment_intent.succeeded')),
  ]);

  const inserts = [a.inserted, b.inserted].sort();
  assertEquals(inserts, [false, true], 'exactly one writer must be the insert-winner');
  assertEquals(mock._rows().length, 1, 'database must hold exactly one payments_v2 row');
  assert(a.payment_id, 'both calls must resolve a payment_id');
  assert(b.payment_id, 'both calls must resolve a payment_id');
  assertEquals(a.payment_id, b.payment_id, 'both calls must resolve to the SAME payment_id');
});

Deno.test('persist race: 5 parallel writers → still 1 row, 1 winner, 4 losers', async () => {
  const mock = makeMockClient();
  const pi = 'pi_RACE_005';
  const row = () => ({
    order_id: 'ord-2', provider: 'stripe', provider_payment_id: pi,
    amount: 7, currency: 'USD', status: 'succeeded',
  });
  // deno-lint-ignore no-explicit-any
  const results = await Promise.all(
    Array.from({ length: 5 }, () => persistStripePaymentIfAbsent(mock as any, pi, row())),
  );
  const winners = results.filter(r => r.inserted).length;
  const losers = results.filter(r => !r.inserted).length;
  assertEquals(winners, 1);
  assertEquals(losers, 4);
  assertEquals(mock._rows().length, 1);
  const ids = new Set(results.map(r => r.payment_id));
  assertEquals(ids.size, 1, 'all callers must converge on the same payment_id');
});

// ---------- 23505 mask-prevention: unrelated unique violation re-thrown ----------

Deno.test('persist 23505: unrelated unique violation is RE-THROWN (not masked as duplicate)', async () => {
  const mock = makeMockClient({ unrelatedUnique: true });
  await assertRejects(
    () => persistStripePaymentIfAbsent(
      // deno-lint-ignore no-explicit-any
      mock as any,
      'pi_UNRELATED_42',
      { provider: 'stripe', provider_payment_id: 'pi_UNRELATED_42', order_id: 'o', amount: 1, currency: 'USD', status: 'succeeded' },
    ),
    Error,
    'unique_violation without matching pi_*',
    '23505 without matching row must throw to prevent masking other constraints',
  );
});
