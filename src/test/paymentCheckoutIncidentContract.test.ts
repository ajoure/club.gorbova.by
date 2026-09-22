import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeEdgeFunctionError } from '@/utils/normalizeEdgeFunctionError';

const subscriptionCheckout = readFileSync(
  path.resolve(__dirname, '../../supabase/functions/bepaid-create-subscription-checkout/index.ts'),
  'utf8',
);

describe('payment checkout incident contract', () => {
  it('returns a stable public error and logs a correlation id with the failing stage', () => {
    expect(subscriptionCheckout).toContain("code: 'SUBSCRIPTION_CHECKOUT_INTERNAL_ERROR'");
    expect(subscriptionCheckout).toContain('incident_id: incidentId');
    expect(subscriptionCheckout).toContain('stage: checkoutStage');
    expect(subscriptionCheckout).not.toContain("JSON.stringify({ error: e.message })");
  });

  it('never exposes a raw internal server error to the customer', () => {
    expect(normalizeEdgeFunctionError(new Error('Internal server error'))).toBe(
      'Не удалось открыть страницу оплаты. Попробуйте ещё раз через несколько секунд.',
    );
    expect(normalizeEdgeFunctionError(new Error('SUBSCRIPTION_CHECKOUT_INTERNAL_ERROR'))).toBe(
      'Не удалось открыть страницу оплаты. Попробуйте ещё раз через несколько секунд.',
    );
  });
});
