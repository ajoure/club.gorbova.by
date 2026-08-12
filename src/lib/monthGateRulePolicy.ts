export interface TrainingContentRuleLike {
  product_id?: string | null;
  tariff_id?: string | null;
  conditions?: Record<string, unknown> | null;
}

export function isMonthPurchaseRule(rule: TrainingContentRuleLike): boolean {
  return rule.conditions?.match_purchase_month === true && Boolean(rule.tariff_id);
}

/**
 * A product entitlement may bypass the month gate only for an explicitly
 * allowlisted non-month rule. Monthly rules always go through
 * has_month_purchase_bulk and stay scoped to their tariff.
 */
export function isExplicitProductBypassRule(
  rule: TrainingContentRuleLike,
): boolean {
  if (!rule.product_id || rule.conditions?.match_purchase_month === true) {
    return false;
  }

  const allowedModules = rule.conditions?.allowed_module_ids;
  const allowedLessons = rule.conditions?.allowed_lesson_ids;
  return (
    (Array.isArray(allowedModules) && allowedModules.length > 0) ||
    (Array.isArray(allowedLessons) && allowedLessons.length > 0)
  );
}
