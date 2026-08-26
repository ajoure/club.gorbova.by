import { assertEquals } from 'jsr:@std/assert@1';
import { resolveEffectiveProductAccess } from './resolve-effective-access.ts';

class QueryStub {
  constructor(
    private readonly table: string,
    private readonly rows: Record<string, unknown[]>,
  ) {}

  select() { return this; }
  eq() { return this; }
  in() { return this; }
  or() { return this; }
  lte() { return this; }
  neq() { return this; }
  gte() { return this; }
  lt() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve({ data: this.rows[this.table] || [], error: null }).then(resolve);
  }
}

Deno.test('product access preserves the exact tariff of an active entitlement source', async () => {
  const rows: Record<string, unknown[]> = {
    subscriptions_v2: [],
    entitlements: [],
    entitlement_sources: [{
      id: 'club-bonus-source',
      expires_at: '2026-09-01T00:00:00.000Z',
      product_id: 'club',
      tariff_id: 'business',
      status: 'active',
    }],
  };
  const supabase = {
    from(table: string) {
      return new QueryStub(table, rows);
    },
  };

  const result = await resolveEffectiveProductAccess(
    supabase as never,
    'user',
    'club',
    new Date('2026-08-26T12:00:00.000Z'),
  );

  assertEquals(result.allSources, [{
    type: 'entitlement_source',
    id: 'club-bonus-source',
    endAt: new Date('2026-09-01T00:00:00.000Z'),
    productId: 'club',
    tariffId: 'business',
    status: 'active',
  }]);
});
