export interface TrainingContentRuleLike {
  product_id?: string | null;
  tariff_id?: string | null;
  conditions?: unknown;
}

function asConditions(rule: TrainingContentRuleLike): Record<string, unknown> {
  const c = rule.conditions;
  return c && typeof c === "object" && !Array.isArray(c)
    ? (c as Record<string, unknown>)
    : {};
}

export function isMonthPurchaseRule(rule: TrainingContentRuleLike): boolean {
  return asConditions(rule).match_purchase_month === true && Boolean(rule.tariff_id);
}

/**
 * A product entitlement may bypass the month gate only for an explicitly
 * allowlisted non-month rule. Monthly rules always go through
 * has_month_purchase_bulk and stay scoped to their tariff.
 */
export function isExplicitProductBypassRule(
  rule: TrainingContentRuleLike,
): boolean {
  const conditions = asConditions(rule);
  if (!rule.product_id || conditions.match_purchase_month === true) {
    return false;
  }

  const allowedModules = conditions.allowed_module_ids;
  const allowedLessons = conditions.allowed_lesson_ids;
  return (
    (Array.isArray(allowedModules) && allowedModules.length > 0) ||
    (Array.isArray(allowedLessons) && allowedLessons.length > 0)
  );
}

