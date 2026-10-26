import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/bepaid-get-subscription-details/index.ts'),
  'utf8',
);

describe('bePaid last_transaction canonical handoff', () => {
  it('does not audit or perform a successful legacy payment upsert from a snapshot', () => {
    expect(source).not.toContain(".from('payments_v2')");
    expect(source).toContain('enqueueReceiptForRecovery');
    expect(source).toContain('fulfillment_verified: false');
    expect(source).toContain('direct_business_writes: 0');
  });

  it('never substitutes the provider parent for an existing receipt purchase', () => {
    expect(source).not.toContain('paymentData.order_id');
    expect(source).not.toContain(".from('orders_v2')");
    expect(source).toContain('inspectReceiptSync');
  });
});
