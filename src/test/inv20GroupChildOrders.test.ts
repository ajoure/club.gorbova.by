import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260802133000_exclude_group_child_orders_from_inv20.sql'),
  'utf8',
);

const repairFunction = readFileSync(
  resolve(process.cwd(), 'supabase/functions/admin-repair-missing-payments/index.ts'),
  'utf8',
);

describe('INV-20 composable order contract', () => {
  it('suppresses only a verified group child backed by a parent payment', () => {
    expect(migration).toContain("meta->>'group_child_order'");
    expect(migration).toContain("meta->>'group_payment_id'");
    expect(migration).toContain("meta->>'group_primary_order_id'");
    expect(migration).toContain("meta->>'order_group_id'");
    expect(migration).toContain("lower(group_payment.id::text) = lower(b.meta->>'group_payment_id')");
    expect(migration).toContain("lower(group_payment.order_id::text) = lower(b.meta->>'group_primary_order_id')");
    expect(migration).toContain("lower(payment_group.primary_order_id::text) = lower(b.meta->>'group_primary_order_id')");
    expect(migration).toContain('group_payment.user_id IS NOT DISTINCT FROM b.user_id');
    expect(migration).toContain('payment_group.user_id IS NOT DISTINCT FROM b.user_id');
    expect(migration).toContain("group_item.role = 'addon'");
    expect(migration).toContain("group_payment.status::text = 'succeeded'");
    expect(migration).toContain("payment_group.status::text = 'paid'");
    expect(migration).toMatch(/THEN\s+'suppressed'/i);
  });

  it('keeps the repair function from materializing a child payment', () => {
    expect(repairFunction).toContain('getGroupChildReferences(order.meta)');
    expect(repairFunction).toContain('group_child_order_payment_on_parent');
    expect(repairFunction).toContain('uid: "__no_real_payment__"');
    expect(repairFunction).toContain('source: "group_child_order"');
    expect(repairFunction).toContain('group_child_payment_lookup_failed');
    expect(repairFunction).toContain('group_child_order_group_lookup_failed');
    expect(repairFunction).toContain('group_child_membership_lookup_failed');
    expect(repairFunction).toContain('isCanonicalGroupChildLink({');
  });

  it('preserves restricted RPC execution', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
