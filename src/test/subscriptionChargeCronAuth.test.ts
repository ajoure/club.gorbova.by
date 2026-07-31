import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const source = readFileSync(path.join(root, 'supabase/functions/subscription-charge/index.ts'), 'utf8');
const config = readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const migration = readFileSync(path.join(root, 'supabase/migrations/20260731091000_harden_subscription_charge_cron.sql'), 'utf8');

describe('subscription-charge cron boundary', () => {
  it('requires the Vault-backed cron header before processing subscriptions', () => {
    expect(source).toMatch(/requestHasSubscriptionChargeCronSecret\(req, supabase\)/);
    expect(source).toMatch(/status:\s*401/);
    expect(config).toMatch(/\[functions\.subscription-charge\][\s\S]*?verify_jwt\s*=\s*false/);
  });

  it('replaces both known public-anon cron jobs with Vault-backed headers', () => {
    expect(migration).toMatch(/subscription-charge-morning/);
    expect(migration).toMatch(/subscription-charge-evening/);
    expect(migration).toMatch(/subscription_charge_cron_secret/);
    expect(migration).toMatch(/x-subscription-charge-cron-secret/);
    expect(migration).not.toMatch(/"Authorization"\s*,\s*"Bearer/);
  });
});
