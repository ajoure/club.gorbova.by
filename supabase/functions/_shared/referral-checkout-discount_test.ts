import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { applyReferralDiscount } from './referral-checkout-discount.ts';

Deno.test('5% referral discount reduces 500 BYN to 475 BYN', () => {
  assertEquals(applyReferralDiscount(50_000, 500), 47_500);
});

Deno.test('discount uses integer minor units and rounds once', () => {
  assertEquals(applyReferralDiscount(9_999, 333), 9_666);
});

Deno.test('5% is never baked into an open-ended subscription amount', async () => {
  const { resolveReferralCheckoutDiscount } = await import('./referral-checkout-discount.ts');
  const result = await resolveReferralCheckoutDiscount({
    supabase: { from: () => { throw new Error('database must not be queried'); } },
    userId: 'user', productId: 'product', amountMinor: 50_000, allowImmediateDiscount: false,
  });
  assertEquals(result.finalAmountMinor, 50_000);
  assertEquals(result.applied, false);
});
