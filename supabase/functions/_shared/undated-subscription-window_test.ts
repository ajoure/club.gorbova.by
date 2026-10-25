import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { syncSecondaryProductAccessForUser } from './product-access-grants.ts';

const targets = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const baseSource = { id: 'source', user_id: 'buyer', profile_id: 'profile', product_id: 'club', tariff_id: 'business', status: 'past_due', access_end_at: null };

function database(source: Record<string, unknown> | null, error: unknown = null) {
  const accessWrites: unknown[] = [];
  const ledgerWrites: Array<Record<string, unknown>> = [];
  let sourceReads = 0;
  const client = {
    from(table: string) {
      if (table === 'subscriptions_v2') {
        sourceReads++;
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: source, error }) }) }) };
      }
      if (table === 'products_v2') return { select: () => ({ in: () => Promise.resolve({ data: targets.map(id => ({ id, code: id })) }) }) };
      if (table === 'entitlements') return {
        select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
        insert: (row: unknown) => { accessWrites.push(row); return Promise.resolve({ error: null }); },
        update: (row: unknown) => { accessWrites.push(row); throw new Error('Unexpected access update'); },
      };
      if (table === 'access_grant_ledger') return { insert: (row: Record<string, unknown>) => {
        ledgerWrites.push(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'ledger', execution_key: 'key' }, error: null }) }) };
      } };
      throw new Error(`Unexpected query ${table}`);
    },
  };
  return { client, accessWrites, ledgerWrites, sourceReads: () => sourceReads };
}

function params(duration: number | null = 30) {
  return {
    userId: 'buyer', profileId: 'profile', sourceProductId: 'club', sourceTariffId: 'business',
    sourceSubscription: { id: 'source', access_end_at: null as string | null },
    rules: [{ id: 'rule', product_id: 'club', tariff_id: 'business', duration_days: duration, scope: 'tariff' as const,
      conditions: { target_product_ids: targets } }],
    ctx: { sourceEventType: 'cron' as const, sourceSubjectType: 'cron_job' as const, sourceEventKeyPrefix: 'fixture' },
  };
}

for (const status of ['past_due', 'pending', 'canceled', 'expired', 'superseded']) {
  Deno.test(`undated ${status} cannot grant nine products through a rule duration`, async () => {
    const db = database({ ...baseSource, status });
    const actions = await syncSecondaryProductAccessForUser(db.client as never, params());
    assertEquals(actions.length, 9);
    assertEquals(actions.map(a => a.outcome), targets.map(() => 'no_source_window'));
    assertEquals(actions.map(a => a.planned_expires_at), targets.map(() => null));
    assertEquals(db.accessWrites, []);
    assertEquals(db.sourceReads(), 1);
    assertEquals(db.ledgerWrites.map(r => r.status), targets.map(() => 'skipped'));
  });
}

for (const source of [null, { ...baseSource, user_id: 'foreign' }, { ...baseSource, tariff_id: 'foreign' },
  { ...baseSource, product_id: 'foreign' }, { ...baseSource, profile_id: 'foreign' },
  { ...baseSource, access_end_at: '2099-01-01T00:00:00Z' }]) {
  Deno.test(`missing, foreign or changed source fails closed: ${JSON.stringify(source)}`, async () => {
    const db = database(source);
    const actions = await syncSecondaryProductAccessForUser(db.client as never, params());
    assertEquals(actions.every(a => a.outcome === 'failed'), true);
    assertEquals(db.accessWrites, []);
    assertEquals(db.ledgerWrites.every(r => r.status === 'failed'), true);
  });
}

Deno.test('source query error does not grant or report a successful ledger outcome', async () => {
  const db = database(null, { code: 'unavailable' });
  const actions = await syncSecondaryProductAccessForUser(db.client as never, params());
  assertEquals(actions.every(a => a.outcome === 'failed'), true);
  assertEquals(db.accessWrites, []);
  assertEquals(db.ledgerWrites.every(r => r.status === 'failed'), true);
});

for (const status of ['active', 'trial']) {
  Deno.test(`confirmed open-ended ${status} retains existing configured-duration behavior`, async () => {
    const db = database({ ...baseSource, status });
    const actions = await syncSecondaryProductAccessForUser(db.client as never, params());
    assertEquals(actions.every(a => a.outcome === 'granted'), true);
    assertEquals(db.accessWrites.length, 9);
  });
}

Deno.test('finite past_due source is unaffected and is not treated as an undated checkout', async () => {
  const db = database(null);
  const input = params(null);
  input.sourceSubscription.access_end_at = '2099-01-01T00:00:00Z';
  const actions = await syncSecondaryProductAccessForUser(db.client as never, input);
  assertEquals(db.sourceReads(), 0);
  assertEquals(actions.every(a => a.planned_expires_at === input.sourceSubscription.access_end_at), true);
  assertEquals(db.accessWrites.length, 9);
});

Deno.test('finite independent Club bonus does not require a recurring subscription or retail payment', async () => {
  const db = database(null);
  const input = { ...params(null), sourceSubscription: null,
    sourceEntitlementSource: { id: 'finite-bonus', access_end_at: '2099-01-01T00:00:00Z' } };
  const actions = await syncSecondaryProductAccessForUser(db.client as never, input);
  assertEquals(db.sourceReads(), 0);
  assertEquals(actions.every(a => a.source_access_kind === 'entitlement_source' && a.planned_expires_at === input.sourceEntitlementSource.access_end_at), true);
  assertEquals(db.accessWrites.length, 9);
});
