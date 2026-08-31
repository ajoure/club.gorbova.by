import { describe, expect, it } from 'vitest';
import { loadDealAccessSubscription } from './dealAccessSubscription';

const deal = { id: 'renewal', user_id: 'user', product_id: 'product', tariff_id: 'tariff' };
const base = { id: 'sub', user_id: 'user', product_id: 'product', tariff_id: 'tariff', status: 'active', order_id: 'parent', meta: { extended_by_orders: ['renewal'] } };
function fixture(rows: any[]) {
  const calls: Record<string, unknown>[] = [];
  const db = { from: () => {
    const filters: Record<string, any> = {}; calls.push(filters);
    const query = { select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      contains: (_key: string, value: any) => { filters.extended = value.extended_by_orders[0]; return query; },
      maybeSingle: async () => {
        const found = rows.filter(row => Object.entries(filters).every(([key, value]) => key === 'extended'
          ? row.meta?.extended_by_orders?.includes(value) : row[key] === value));
        return { data: found[0] || null, error: found.length > 1 ? new Error('ambiguous') : null };
      },
    }; return query;
  } };
  return { db: db as unknown as Parameters<typeof loadDealAccessSubscription>[0], calls };
}

describe('same-deal subscription lineage', () => {
  it('keeps direct order linkage', async () => {
    const f = fixture([{ ...base, order_id: 'renewal' }]);
    expect((await loadDealAccessSubscription(f.db, deal))?.id).toBe('sub');
    expect(f.calls).toHaveLength(2);
  });
  it('finds a renewal recorded in extended_by_orders without changing the original order', async () => {
    const f = fixture([base]);
    expect((await loadDealAccessSubscription(f.db, deal))?.order_id).toBe('parent');
    expect(f.calls[1]).toMatchObject({ user_id: 'user', product_id: 'product', tariff_id: 'tariff', extended: 'renewal' });
  });
  it('shows the active linked successor instead of the expired original order subscription', async () => {
    const f = fixture([{ ...base, id: 'old', order_id: 'renewal', status: 'expired', meta: {} }, base]);
    expect((await loadDealAccessSubscription(f.db, deal))?.id).toBe('sub');
  });
  it('does not choose between two active direct/extended chains', async () => {
    const f = fixture([{ ...base, id: 'other', order_id: 'renewal', meta: {} }, base]);
    await expect(loadDealAccessSubscription(f.db, deal)).rejects.toThrow('Неоднозначная');
  });
  it.each(['user_id', 'product_id', 'tariff_id'])('does not display a foreign %s chain', async key => {
    const f = fixture([{ ...base, [key]: 'foreign' }]);
    expect(await loadDealAccessSubscription(f.db, deal)).toBeNull();
  });
  it('does not choose one of two linked subscriptions', async () => {
    const f = fixture([base, { ...base, id: 'second' }]);
    await expect(loadDealAccessSubscription(f.db, deal)).rejects.toThrow('ambiguous');
  });
  it('does not query access for a contact without an auth user', async () => {
    const f = fixture([base]);
    expect(await loadDealAccessSubscription(f.db, { ...deal, user_id: null })).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
});
