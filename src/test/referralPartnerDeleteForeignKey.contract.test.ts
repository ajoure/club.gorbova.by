import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260728181500_referral_partners_created_by_set_null.sql'),
  'utf8',
);

describe('referral partner author deletion contract', () => {
  it('keeps the partner row and clears only its optional audit author', () => {
    expect(migration).toContain("'public.referral_partners'::regclass");
    expect(migration).toContain("'created_by'");
    expect(migration).toContain('REFERENCES auth.users(id)');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.referral_partners/i);
  });

  it('fails closed if the live column unexpectedly requires an author', () => {
    expect(migration).toContain('author_is_required');
    expect(migration).toContain('refusing to change delete behavior');
  });
});
