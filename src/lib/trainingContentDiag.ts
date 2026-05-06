/**
 * Diagnostic logger for training_content resolver.
 * Disabled by default. Enable by setting localStorage.debug.training_content = '1'.
 * NEVER logs PII (no names, no emails). Only ids and rule classifications.
 */
export type RuleSource =
  | "db_tariff"
  | "db_product"
  | "synthetic_bonus"
  | "synthetic_legacy"
  | "admin_grant_full_fallback"
  | "rule_unresolved"
  | "no_rule";

export interface TrainingContentDiagPayload {
  user_id: string | null;
  product_id: string | null;
  training_module_id: string;
  entitlement_tariff_id: string | null;
  subscription_tariff_ids: string[];
  matched_rule_id: string | null;
  rule_source: RuleSource;
  fallback_reason?: string;
  allowed_module_count?: number;
}

export function isTrainingContentDiagEnabled(): boolean {
  try {
    return typeof window !== "undefined" &&
      window.localStorage?.getItem("debug.training_content") === "1";
  } catch {
    return false;
  }
}

export function logTrainingContentDiag(payload: TrainingContentDiagPayload): void {
  if (!isTrainingContentDiagEnabled()) return;
  // eslint-disable-next-line no-console
  console.info("[training_content_diag]", payload);
}
