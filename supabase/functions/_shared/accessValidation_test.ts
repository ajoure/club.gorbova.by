import {
  type AccessCheckResult,
  selectWiderCommercialAccess,
} from './accessValidation.ts';

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
