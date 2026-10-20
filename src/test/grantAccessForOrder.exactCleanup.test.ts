import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual production cleanup branch in isolation. This is a
// cross-subscription write boundary, not a second implementation of its rule.
const source = readFileSync('supabase/functions/grant-access-for-order/index.ts', 'utf8');
const cleanup = source.slice(source.indexOf('const newSubId = results.subscription?.id;'),
  source.indexOf('// The Club bonus has its own finite source'));

describe('exact paid-window ownership boundary', () => {
  it.each([true, false])('cross-subscription cleanup with exact target=%s', async exact => {
    const reads: string[] = [], writes: unknown[] = [];
    const supabase = { from(table: string) {
      reads.push(table); const q: any = {};
      for (const name of ['select', 'eq', 'neq']) q[name] = () => q;
      q.update = (value: unknown) => { writes.push(value); return q; };
      q.maybeSingle = async () => ({ data: { email: null }, error: null });
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'other-subscription' }], error: null }).then(resolve);
      return q;
    } };
    await runInNewContext(`(async()=>{${cleanup}})()`, { supabase, results: { subscription: { id: 'target-subscription' } },
      exactAccessTarget: exact ? { subscriptionId: 'target-subscription' } : null, userId: 'test-user',
      productId: 'test-product', orderId: 'test-order', STAFF_EMAILS: [], now: new Date('2026-10-20T00:00:00Z'), console: { log() {} } });
    if (exact) { expect(reads).toEqual([]); expect(writes).toEqual([]); }
    else { expect(reads).toContain('subscriptions_v2'); expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ auto_renew: false }); }
  });
});
