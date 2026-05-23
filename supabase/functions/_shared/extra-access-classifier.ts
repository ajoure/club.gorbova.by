/**
 * Stage 4 — Extra-access classifier (pure functions).
 *
 * Detects active entitlements that are NOT covered by any active access_rule
 * AND have no independent paid/subscription source window justifying them.
 *
 * Used by:
 *   - rules-retroapply (preview + execute via destructive flags)
 *   - access-rules-nightly-reconcile (preview-only via shared call; audit summary)
 *
 * SOT principles:
 *   - paid order / active subscription window > rule coverage
 *   - manual/admin/cohort_repair/admin_edit lineage = "human"
 *   - system lineage = retroapply / rule_engine / fulfillment / batch
 *   - unknown lineage = neither, behaves like "human" in nightly_safe
 *   - physical DELETE entitlements is forbidden — soft_expire / revoke only
 */

export type Lineage = "manual_admin" | "system" | "none";

export interface EntitlementSnapshot {
  id: string;
  user_id: string;
  product_id: string;
  expires_at: string | null;
  status: string;
  meta: Record<string, unknown> | null;
}

export interface PaidWindow {
  /** epoch ms; access_end_at upper bound from orders_v2/subscriptions_v2 */
  end_ms: number | null;
  /** identifier of the source for audit */
  source: "order" | "subscription";
  source_id: string;
}

export interface RuleCoverage {
  /** any active rule grants this product to this user */
  covered: boolean;
  /** the rule that covers (for audit), null if uncovered */
  rule_id: string | null;
  /** planned expiry by that rule, epoch ms */
  rule_end_ms: number | null;
}

export type ExtraAccessCategory =
  | "already_correct"
  | "soft_expire_extra_access"
  | "revoke_extra_access"
  | "manual_review_ambiguous_source"
  | "manual_review_paid_access_exists";

export interface ExtraAccessClassification {
  category: ExtraAccessCategory;
  reason: string;
  lineage: Lineage;
  /** if true — admin_canonicalize_all + allow_manual_override required to execute */
  human_lineage_protected: boolean;
  /** Maximum end_ms from paid sources (or null) */
  paid_end_ms: number | null;
}

/**
 * Detect entitlement lineage from meta. Mirrors rules-retroapply detector,
 * kept here as a single source of truth.
 */
export function detectLineage(meta: Record<string, unknown> | null): Lineage {
  if (!meta) return "none";
  const sourceType = String(meta.source_type || "").toLowerCase();
  const grantedBy = String(meta.granted_by || "").toLowerCase();
  const batchId = String(meta.batch_id || "");

  const isManual =
    sourceType === "manual" || sourceType === "admin" ||
    sourceType === "cohort_repair" || sourceType === "admin_edit" ||
    sourceType.startsWith("manual_") ||
    grantedBy.includes("manual") || grantedBy.includes("admin") ||
    !!meta.manual_access_edit_last_at || !!meta.actor_user_id ||
    !!meta.granted_by_admin;
  if (isManual) return "manual_admin";

  const isSystem =
    !!meta.retroapply || !!meta.retroapply_updated || !!meta.retroapply_reactivated ||
    sourceType === "rule_engine" || sourceType === "retroapply" ||
    sourceType === "fulfillment" || sourceType === "batch" ||
    grantedBy.startsWith("rule_engine") || grantedBy === "primary_order_fulfillment" ||
    batchId.startsWith("BACKFILL") || batchId.startsWith("RETROAPPLY") ||
    !!meta.source_rule_id;
  return isSystem ? "system" : "none";
}

/**
 * Core classifier. Given an active entitlement, rule coverage, and paid windows,
 * returns the extra-access verdict.
 */
export function classifyEntitlement(
  ent: EntitlementSnapshot,
  coverage: RuleCoverage,
  paidWindows: PaidWindow[],
  nowMs: number = Date.now(),
): ExtraAccessClassification {
  const lineage = detectLineage(ent.meta);
  const humanProtected = lineage === "manual_admin" || lineage === "none";
  const currentEndMs = ent.expires_at ? new Date(ent.expires_at).getTime() : null;
  const paidEndMs = paidWindows.reduce<number | null>((acc, w) => {
    if (w.end_ms == null) return acc;
    return acc == null || w.end_ms > acc ? w.end_ms : acc;
  }, null);

  // Case 1: rule covers — already correct (rule-engine will align via aligned_update_needed,
  // not via this detector).
  if (coverage.covered) {
    return {
      category: "already_correct",
      reason: "rule_covers_entitlement",
      lineage,
      human_lineage_protected: humanProtected,
      paid_end_ms: paidEndMs,
    };
  }

  // Case 2: paid window exists and covers current expiry — keep entitlement, just flag.
  if (paidEndMs != null && currentEndMs != null && paidEndMs >= currentEndMs - 60_000) {
    return {
      category: "manual_review_paid_access_exists",
      reason: "paid_window_covers_current_expiry",
      lineage,
      human_lineage_protected: humanProtected,
      paid_end_ms: paidEndMs,
    };
  }

  // Case 3: paid window exists but is SHORTER than current expiry → ambiguous.
  // We don't auto-reduce here (that's reducible_by_rule path). Mark for review.
  if (paidEndMs != null && currentEndMs != null && paidEndMs < currentEndMs - 60_000) {
    return {
      category: "manual_review_ambiguous_source",
      reason: "paid_window_shorter_than_current_expiry",
      lineage,
      human_lineage_protected: humanProtected,
      paid_end_ms: paidEndMs,
    };
  }

  // Case 4: no rule, no paid window.
  //   - if current expiry is in the past → soft-expire (cheap state fix)
  //   - if current expiry is in the future → revoke as zombie
  if (currentEndMs == null || currentEndMs <= nowMs) {
    return {
      category: "soft_expire_extra_access",
      reason: currentEndMs == null
        ? "no_expires_at_no_source"
        : "expired_but_active_no_source",
      lineage,
      human_lineage_protected: humanProtected,
      paid_end_ms: paidEndMs,
    };
  }

  return {
    category: "revoke_extra_access",
    reason: "future_expiry_no_rule_no_paid_source",
    lineage,
    human_lineage_protected: humanProtected,
    paid_end_ms: paidEndMs,
  };
}

/**
 * Permission gate for executing destructive actions.
 * Returns true only when ALL preconditions are met.
 */
export function canExecuteDestructive(
  classification: ExtraAccessClassification,
  opts: {
    reconcileMode: "nightly_safe" | "admin_canonicalize_all";
    allowRevokeOrExpire: boolean;
    allowManualOverride: boolean;
    isSuperAdmin: boolean;
    explicitlySelected: boolean;
  },
): { allowed: boolean; reason: string } {
  if (classification.category === "already_correct") {
    return { allowed: false, reason: "no_action_needed" };
  }
  if (
    classification.category === "manual_review_paid_access_exists" ||
    classification.category === "manual_review_ambiguous_source"
  ) {
    return { allowed: false, reason: "preview_only_manual_review" };
  }
  if (!opts.explicitlySelected) {
    return { allowed: false, reason: "destructive_requires_explicit_selection" };
  }
  if (!opts.allowRevokeOrExpire) {
    return { allowed: false, reason: "allow_revoke_or_expire_required" };
  }
  if (classification.human_lineage_protected) {
    if (opts.reconcileMode !== "admin_canonicalize_all") {
      return { allowed: false, reason: "nightly_safe_protects_human_lineage" };
    }
    if (!opts.isSuperAdmin) {
      return { allowed: false, reason: "super_admin_required_for_human_lineage" };
    }
    if (!opts.allowManualOverride) {
      return { allowed: false, reason: "allow_manual_override_required" };
    }
  }
  return { allowed: true, reason: "ok" };
}
