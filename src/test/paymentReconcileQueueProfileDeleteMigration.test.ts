import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260729074915_payment_reconcile_queue_profile_fk_set_null.sql'),
  'utf8',
);

describe('payment reconciliation profile deletion contract', () => {
  it('preserves queue rows and clears only the optional matched profile', () => {
    expect(migration).toContain("to_regclass('public.payment_reconcile_queue')");
    expect(migration).toContain("attname = 'matched_profile_id'");
    expect(migration).toContain('REFERENCES public.profiles(id)');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.payment_reconcile_queue/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.payment_reconcile_queue/i);
  });

  it('fails closed when the live table or nullable audit column is incompatible', () => {
    expect(migration).toContain('profile_column_is_required');
    expect(migration).toContain('refusing to change delete behavior');
  });
});
