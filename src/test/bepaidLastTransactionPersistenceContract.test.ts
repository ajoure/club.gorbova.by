import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/bepaid-get-subscription-details/index.ts'),
  'utf8',
);

describe('bePaid last_transaction persistence', () => {
  it('does not audit a successful upsert after a failed payment write', () => {
    expect(source).toContain('bepaid.payment.upsert_from_last_transaction_failed');
    expect(source).toContain('payment_insert_failed:');
    expect(source).toContain('payment_update_failed:');
    expect(source).toContain(".eq('provider', 'bepaid')");
    expect(source).toContain('payment_id: persistedPaymentId');
  });

  it('carries the canonical order linkage into the recovered payment', () => {
    expect(source).not.toContain('product_id: resolvedProductId');
    expect(source).toContain('paymentData.order_id = resolvedOrderId || psMetaOrderId');
  });
});
