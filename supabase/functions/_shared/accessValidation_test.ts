import {
  type AccessCheckResult,
  accessBearingSubscriptionFilter,
  calculateRuleBoundClubEndAt,
  selectWiderCommercialAccess,
} from './accessValidation.ts';

Deno.test('technical past_due subscriptions without an access end are excluded', () => {
  assertEquals(
    accessBearingSubscriptionFilter('2026-08-09T00:00:00.000Z'),
    'and(access_end_at.is.null,status.in.(active,trial)),access_end_at.gt.2026-08-09T00:00:00.000Z',
  );
});

Deno.test('the shared filter preserves active/trial perpetual and dated canceled access', () => {
  const filter = accessBearingSubscriptionFilter('2026-08-09T00:00:00.000Z');
  assertEquals(filter.includes('status.in.(active,trial)'), true);
  assertEquals(filter.includes('access_end_at.gt.2026-08-09T00:00:00.000Z'), true);
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const finite = (endAt: string, id: string): AccessCheckResult => ({
  valid: true,
  source: 'entitlement',
  endAt,
  entitlementId: id,
});

Deno.test('widest commercial access keeps the latest finite window', () => {
  const shorter = finite('2026-12-01T00:00:00.000Z', 'shorter');
  const longer = finite('2027-05-31T00:00:00.000Z', 'longer');

  assertEquals(selectWiderCommercialAccess(shorter, longer), longer);
  assertEquals(selectWiderCommercialAccess(longer, shorter), longer);
});

Deno.test('unlimited commercial access wins over finite windows', () => {
  const finiteAccess = finite('2027-05-31T00:00:00.000Z', 'finite');
  const unlimited: AccessCheckResult = {
    valid: true,
    source: 'manual_access',
    endAt: null,
    manualAccessId: 'unlimited',
  };

  assertEquals(selectWiderCommercialAccess(finiteAccess, unlimited), unlimited);
  assertEquals(selectWiderCommercialAccess(unlimited, finiteAccess), unlimited);
});

Deno.test('invalid candidates never replace a valid commercial source', () => {
  const current = finite('2027-05-31T00:00:00.000Z', 'current');
  assertEquals(selectWiderCommercialAccess(current, { valid: false }), current);
});

Deno.test('finite club bonus ends exactly duration_days after confirmed payment', () => {
  assertEquals(
    calculateRuleBoundClubEndAt('2026-07-31T09:15:00.000Z', 30),
    '2026-08-30T09:15:00.000Z',
  );
});

Deno.test('finite club bonus fails closed for invalid payment anchors or durations', () => {
  assertEquals(calculateRuleBoundClubEndAt('not-a-date', 30), null);
  assertEquals(calculateRuleBoundClubEndAt('2026-07-31T09:15:00.000Z', 0), null);
  assertEquals(calculateRuleBoundClubEndAt('2026-07-31T09:15:00.000Z', 30.5), null);
});

Deno.test('a longer directly paid club window wins over the finite bonus', () => {
  const directClub: AccessCheckResult = {
    valid: true,
    source: 'subscription',
    endAt: '2026-12-01T00:00:00.000Z',
    subscriptionId: 'paid-club',
  };
  const bonus: AccessCheckResult = {
    valid: true,
    source: 'paid_order_rule',
    endAt: '2026-08-30T09:15:00.000Z',
    orderId: 'cb20-order',
  };

  assertEquals(selectWiderCommercialAccess(bonus, directClub), directClub);
  assertEquals(selectWiderCommercialAccess(directClub, bonus), directClub);
});
