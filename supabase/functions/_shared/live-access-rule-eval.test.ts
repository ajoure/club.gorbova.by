import { assertEquals } from 'jsr:@std/assert@1';
import {
  evaluateLiveAccessRule,
  resolveAllowedPurchaseMonths,
  snapshotProvesRuleAccess,
} from './live-access-rule-eval.ts';
import type { EffectiveAccessSnapshot } from './resolve-effective-access.ts';

const NOW = new Date('2026-08-14T13:30:00.000Z');

function snapshot(
  sources: EffectiveAccessSnapshot['allSources'],
): EffectiveAccessSnapshot {
  return {
    effectiveEndAt: new Date('2026-08-20T00:00:00.000Z'),
    isUnlimited: false,
    isProtectedByBillingDay: false,
    sourceType: sources[0]?.type ?? null,
    sourceId: sources[0]?.id ?? null,
    allSources: sources,
  };
}

Deno.test('tariff rule rejects access backed only by another tariff', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'subscription',
      id: 'sub-other',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
      tariffId: 'chat',
    }]),
    { product_id: 'club', tariff_id: 'business' },
    NOW,
  );
  assertEquals(result, 'no_matching_tariff_access');
});

Deno.test('tariff rule rejects entitlement-only access', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'entitlement',
      id: 'entitlement',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
    }]),
    { product_id: 'club', tariff_id: 'business' },
    NOW,
  );
  assertEquals(result, 'no_matching_tariff_access');
});

Deno.test('tariff rule accepts an exact tier-aware entitlement source', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'entitlement_source',
      id: 'club-bonus-source',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
      tariffId: 'business',
    }]),
    { product_id: 'club', tariff_id: 'business' },
    NOW,
  );
  assertEquals(result, null);
});

Deno.test('tariff rule rejects a tier-aware source for another tariff', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'entitlement_source',
      id: 'club-bonus-source',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
      tariffId: 'full',
    }]),
    { product_id: 'club', tariff_id: 'business' },
    NOW,
  );
  assertEquals(result, 'no_matching_tariff_access');
});

Deno.test('product-only rule accepts a current entitlement', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'entitlement',
      id: 'entitlement',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
    }]),
    { product_id: 'club', tariff_id: null },
    NOW,
  );
  assertEquals(result, null);
});

Deno.test('exact tariff rule passes when its access-bearing subscription exists', () => {
  const result = snapshotProvesRuleAccess(
    snapshot([{
      type: 'subscription',
      id: 'sub-business',
      endAt: new Date('2026-08-20T00:00:00.000Z'),
      productId: 'club',
      tariffId: 'business',
    }]),
    { product_id: 'club', tariff_id: 'business' },
    NOW,
  );
  assertEquals(result, null);
});

Deno.test('explicit month gate fails closed after product and tariff pass', async () => {
  const result = await evaluateLiveAccessRule(
    {} as never,
    'user',
    {
      id: 'rule',
      product_id: 'club',
      tariff_id: 'business',
      conditions: { match_purchase_month: true },
    },
    { now: NOW, contentMonth: '2026-08' },
    {
      resolveProductAccess: async () => snapshot([{
        type: 'subscription',
        id: 'sub-business',
        endAt: new Date('2026-08-20T00:00:00.000Z'),
        productId: 'club',
        tariffId: 'business',
      }]),
      checkPurchaseMonths: async () => ({
        passed: false,
        reason: 'no_paid_order_in_month',
      }),
    },
  );

  assertEquals(result.allowed, false);
  assertEquals(result.reason, 'month_gate_failed');
  assertEquals(result.monthGateReason, 'no_paid_order_in_month');
});

Deno.test('multi-month gate passes when any configured month matches', async () => {
  const checkedMonths: string[] = [];
  const result = await evaluateLiveAccessRule(
    {} as never,
    'user',
    {
      id: 'rule',
      product_id: 'club',
      tariff_id: 'business',
      conditions: { match_purchase_month: true },
    },
    {
      now: NOW,
      contentMonth: '2026-06',
      purchaseMonths: ['2026-07', '2026-08'],
    },
    {
      resolveProductAccess: async () => snapshot([{
        type: 'subscription',
        id: 'sub-business',
        endAt: new Date('2026-08-20T00:00:00.000Z'),
        productId: 'club',
        tariffId: 'business',
      }]),
      checkPurchaseMonths: async (_client, input) => {
        checkedMonths.push(...input.months);
        return input.months.includes('2026-08')
          ? { passed: true, reason: 'matched' }
          : { passed: false, reason: 'no_paid_order_in_month' };
      },
    },
  );

  assertEquals(result.allowed, true);
  assertEquals(checkedMonths, ['2026-07', '2026-08']);
});

Deno.test('multi-month configuration falls back to the historic content month', () => {
  assertEquals(resolveAllowedPurchaseMonths(undefined, '2026-07'), ['2026-07']);
  assertEquals(
    resolveAllowedPurchaseMonths(['2026-08', 'bad', '2026-08'], '2026-07'),
    ['2026-08'],
  );
});

Deno.test('explicit month gate fails closed when no valid month is configured', async () => {
  const result = await evaluateLiveAccessRule(
    {} as never,
    'user',
    {
      id: 'rule',
      product_id: 'club',
      tariff_id: 'business',
      conditions: { match_purchase_month: true },
    },
    { now: NOW, contentMonth: null, purchaseMonths: ['invalid'] },
    {
      resolveProductAccess: async () => snapshot([{
        type: 'subscription',
        id: 'sub-business',
        endAt: new Date('2026-08-20T00:00:00.000Z'),
        productId: 'club',
        tariffId: 'business',
      }]),
      checkPurchaseMonths: async (_client, input) => ({
        passed: false,
        reason: input.months.length === 0
          ? 'invalid_month_format'
          : 'no_paid_order_in_month',
      }),
    },
  );

  assertEquals(result.allowed, false);
  assertEquals(result.monthGateReason, 'invalid_month_format');
});
