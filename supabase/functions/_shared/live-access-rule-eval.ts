import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { checkAnyMonthPurchase, isValidMonthKey } from './check-month-purchase.ts';
import {
  EffectiveAccessSnapshot,
  resolveEffectiveProductAccess,
} from './resolve-effective-access.ts';

export interface LiveAccessRule {
  id?: string | null;
  rule_kind?: string | null;
  product_id?: string | null;
  tariff_id?: string | null;
  conditions?: Record<string, unknown> | null;
}

export type LiveAccessRuleReason =
  | 'allowed'
  | 'any_authenticated'
  | 'missing_product'
  | 'no_product_access'
  | 'no_matching_tariff_access'
  | 'month_gate_failed';

export interface LiveAccessRuleResult {
  allowed: boolean;
  reason: LiveAccessRuleReason;
  ruleId: string | null;
  monthGateReason?: string;
}

export interface LiveAccessRuleContext {
  now?: Date;
  contentMonth?: unknown;
  purchaseMonths?: unknown;
}

interface LiveAccessRuleDependencies {
  resolveProductAccess: typeof resolveEffectiveProductAccess;
  checkPurchaseMonths: typeof checkAnyMonthPurchase;
}

const defaultDependencies: LiveAccessRuleDependencies = {
  resolveProductAccess: resolveEffectiveProductAccess,
  checkPurchaseMonths: checkAnyMonthPurchase,
};

export function resolveAllowedPurchaseMonths(
  purchaseMonths: unknown,
  contentMonth: unknown,
): string[] {
  const explicitMonths = Array.isArray(purchaseMonths)
    ? [...new Set(purchaseMonths.filter(isValidMonthKey))]
    : [];

  if (explicitMonths.length > 0) return explicitMonths;
  return isValidMonthKey(contentMonth) ? [contentMonth] : [];
}

export function snapshotProvesRuleAccess(
  snapshot: EffectiveAccessSnapshot,
  rule: LiveAccessRule,
  now: Date,
): LiveAccessRuleReason | null {
  const hasProductAccess = snapshot.isUnlimited ||
    Boolean(snapshot.effectiveEndAt && snapshot.effectiveEndAt > now);
  if (!hasProductAccess) return 'no_product_access';

  if (rule.tariff_id) {
    const hasExactTariffAccess = snapshot.allSources.some((source) =>
      (source.type === 'subscription' || source.type === 'entitlement_source') &&
      source.tariffId === rule.tariff_id
    );
    if (!hasExactTariffAccess) return 'no_matching_tariff_access';
  }
  return null;
}

/**
 * Canonical evaluator for one live-event rule.
 *
 * A tariff-scoped rule is fail-closed: the effective product access must be
 * backed by an access-bearing subscription or an active tier-aware
 * entitlement source for that exact tariff. A generic aggregate entitlement
 * may satisfy a product-only rule, but can never prove a tariff.
 */
export async function evaluateLiveAccessRule(
  supabase: SupabaseClient,
  userId: string,
  rule: LiveAccessRule,
  context: LiveAccessRuleContext = {},
  dependencies: LiveAccessRuleDependencies = defaultDependencies,
): Promise<LiveAccessRuleResult> {
  const ruleId = rule.id ?? null;
  if (rule.rule_kind === 'any_authenticated') {
    return { allowed: true, reason: 'any_authenticated', ruleId };
  }
  if (!rule.product_id) {
    return { allowed: false, reason: 'missing_product', ruleId };
  }

  const now = context.now ?? new Date();
  const snapshot = await dependencies.resolveProductAccess(
    supabase,
    userId,
    rule.product_id,
    now,
  );
  const accessFailure = snapshotProvesRuleAccess(snapshot, rule, now);
  if (accessFailure) {
    return { allowed: false, reason: accessFailure, ruleId };
  }

  const conditions = rule.conditions ?? {};
  if (conditions.match_purchase_month === true) {
    const allowedMonths = resolveAllowedPurchaseMonths(
      context.purchaseMonths,
      context.contentMonth,
    );
    const monthCheck = await dependencies.checkPurchaseMonths(supabase, {
      user_id: userId,
      tariff_id: rule.tariff_id ?? null,
      months: allowedMonths,
    });
    if (!monthCheck.passed) {
      return {
        allowed: false,
        reason: 'month_gate_failed',
        ruleId,
        monthGateReason: monthCheck.reason,
      };
    }
  }

  return { allowed: true, reason: 'allowed', ruleId };
}

export async function evaluateLiveAccessRules(
  supabase: SupabaseClient,
  userId: string,
  rules: LiveAccessRule[],
  context: LiveAccessRuleContext = {},
): Promise<LiveAccessRuleResult> {
  let lastResult: LiveAccessRuleResult = {
    allowed: false,
    reason: 'missing_product',
    ruleId: null,
  };
  for (const rule of rules) {
    lastResult = await evaluateLiveAccessRule(supabase, userId, rule, context);
    if (lastResult.allowed) return lastResult;
  }
  return lastResult;
}
