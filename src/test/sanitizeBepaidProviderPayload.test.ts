import { describe, expect, it } from 'vitest';
import { sanitizeBepaidProviderPayload } from '../../supabase/functions/_shared/sanitize-bepaid-payload.ts';

describe('sanitizeBepaidProviderPayload', () => {
  it('keeps reconciliation facts but never persists card, customer, or token fields', () => {
    const safe = sanitizeBepaidProviderPayload({
      id: 'sub_1',
      customer: { email: 'member@example.com', phone: '+375291234567' },
      transaction: {
        uid: 'tx_1', status: 'successful', amount: 19900, currency: 'BYN',
        credit_card: { token: 'do-not-store', holder: 'Member Name', last_4: '1111' },
        customer: { email: 'member@example.com' },
      },
    });

    expect(safe).toMatchObject({ id: 'sub_1', transaction: { uid: 'tx_1', amount: 19900 } });
    expect(JSON.stringify(safe)).not.toContain('do-not-store');
    expect(JSON.stringify(safe)).not.toContain('member@example.com');
    expect(JSON.stringify(safe)).not.toContain('Member Name');
  });
});
