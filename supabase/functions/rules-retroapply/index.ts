/**
 * rules-retroapply — Universal engine for retroactively applying access_rules
 * to historical data (existing subscriptions/orders).
 *
 * Modes:
 *   preview  — read-only list of affected users + planned actions
 *   execute  — batch create/update entitlements for missing access
 *
 * Scope options:
 *   rule_ids           — specific rule IDs to retroapply
 *   source_product_id  — all active rules for this product
 *   source_tariff_id   — all active rules for this tariff
 *   changed_since      — all active rules updated after this date
 *
 * Categories per user×rule:
 *   missing_access          — no entitlement, will create
 *   aligned_update_needed   — entitlement exists but expires_at misaligned (safe extend or missing)
 *   reducible_by_rule       — entitlement exists, planned < current, safe canonical source
 *   requires_manual_review  — ambiguous, admin must decide
 *   conflict_existing       — real conflict, never auto-executed
 *   already_satisfied       — entitlement correct, skip
 *   condition_not_met       — prior_purchase condition failed, skip
 *   no_source_window        — align_with_source but no subscription found, conflict
 *
 * Execute modes (via apply_categories / selected_action_ids / allow_reduce_access):
 *   safe_only     — missing_access + aligned_update_needed
 *   with_reduce   — + reducible_by_rule (requires allow_reduce_access=true)
 *   selected      — only selected_action_ids (allow_reduce_access implied)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { checkPriorPurchase } from "../_shared/check-prior-purchase.ts";
import {
  classifyEntitlement,
  canExecuteDestructive,
  type EntitlementSnapshot,
  type PaidWindow,
  type RuleCoverage,
  type ExtraAccessClassification,
} from "../_shared/extra-access-classifier.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ReconcileMode = "nightly_safe" | "admin_canonicalize_all";

interface RetroApplyRequest {
  mode: "preview" | "execute";
  /** Stage 3: режим reconcile — nightly_safe (ночной осторожный) или admin_canonicalize_all (полная админская канонизация) */
  reconcile_mode?: ReconcileMode;
  rule_ids?: string[];
  source_product_id?: string;
  source_tariff_id?: string;
  changed_since?: string;
  recalculate_existing?: boolean;
  force_execute?: boolean;
  allow_reduce_access?: boolean;
  /** Stage 3 destructive flags — only honored in admin_canonicalize_all + super_admin */
  allow_revoke_or_expire_access?: boolean;
  allow_manual_override?: boolean;
  selected_action_ids?: string[];
  apply_categories?: string[];
  /** Optional: limit processing to specific user UUIDs (prevents full-scan timeouts) */
  user_ids?: string[];
  /** Optional: limit processing to specific target product UUIDs */
  target_product_ids?: string[];
}

interface UserAction {
  action_id: string;
  user_id: string;
  profile_id: string | null;
  email: string;
  full_name: string | null;
  rule_id: string;
  rule_target_type: string;
  rule_target_label: string | null;
  rule_source_product_name: string | null;
  rule_source_tariff_name: string | null;
  rule_duration_mode: string;
  rule_duration_days: number | null;
  target_product_id: string;
  target_product_code: string;
  target_product_name: string;
  category: string;
  planned_expires_at: string | null;
  current_expires_at: string | null;
  source_subscription_id: string | null;
  skip_reason: string | null;
  /** Stage 3: маркер того, что admin_canonicalize_all переопределит ручную/admin lineage */
  lineage_will_be_overridden?: boolean;
  /** Stage 3: текущая lineage записи для UI */
  current_lineage?: "manual_admin" | "system" | "none" | null;
  /** Stage 5: откуда взят срок (rule_duration / source_access_end_at / tariff_access_days / null) */
  window_resolved_from?: "rule_duration" | "source_access_end_at" | "tariff_access_days" | null;
  /** Stage 5: на какую дату «привязан» расчёт (sub_access_end_at / sub_access_start_at / sub_created_at / now) */
  window_anchor_source?: "sub_access_end_at" | "sub_access_start_at" | "sub_created_at" | "rule_duration_now" | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RetroApplyRequest = await req.json();
    const {
      mode, rule_ids, source_product_id, source_tariff_id, changed_since,
      recalculate_existing, allow_reduce_access, selected_action_ids, apply_categories,
      user_ids, target_product_ids,
    } = body;
    const reconcileMode: ReconcileMode = body.reconcile_mode === "admin_canonicalize_all"
      ? "admin_canonicalize_all"
      : "nightly_safe";
    const allowRevokeOrExpire = !!body.allow_revoke_or_expire_access;
    const allowManualOverride = !!body.allow_manual_override;

    if (!mode || !["preview", "execute"].includes(mode)) {
      return jsonResp({ error: "mode must be 'preview' or 'execute'" }, 400);
    }

    if (!rule_ids?.length && !source_product_id && !source_tariff_id && !changed_since) {
      return jsonResp({ error: "At least one scope param required: rule_ids, source_product_id, source_tariff_id, changed_since" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Stage 3: super_admin gate for admin_canonicalize_all mode (in BOTH preview and execute)
    let callerUserId: string | null = null;
    if (reconcileMode === "admin_canonicalize_all") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) {
        return jsonResp({ error: "admin_canonicalize_all_requires_auth" }, 401);
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user?.id) {
        return jsonResp({ error: "admin_canonicalize_all_invalid_jwt" }, 401);
      }
      callerUserId = userData.user.id;
      const { data: isSuper, error: roleErr } = await supabase.rpc("has_role_v2", {
        _user_id: callerUserId,
        _role_code: "super_admin",
      });
      if (roleErr || !isSuper) {
        return jsonResp({ error: "admin_canonicalize_all_requires_super_admin" }, 403);
      }
    }

    // 1. Resolve rules
    const rules = await resolveRules(supabase, { rule_ids, source_product_id, source_tariff_id, changed_since });

    if (rules.length === 0) {
      return jsonResp({ mode, reconcile_mode: reconcileMode, rules_found: 0, actions: [], summary: emptySummary() });
    }

    // Resolve source product/tariff names for UI
    const sourceProductIds = [...new Set(rules.map((r: any) => r.product_id).filter(Boolean))];
    const sourceTariffIds = [...new Set(rules.map((r: any) => r.tariff_id).filter(Boolean))];

    const sourceProductNameMap = new Map<string, string>();
    const sourceTariffNameMap = new Map<string, string>();

    if (sourceProductIds.length > 0) {
      const { data: prods } = await supabase.from("products_v2").select("id, name").in("id", sourceProductIds);
      (prods || []).forEach((p: any) => sourceProductNameMap.set(p.id, p.name));
    }
    if (sourceTariffIds.length > 0) {
      const { data: tars } = await supabase.from("tariffs").select("id, name").in("id", sourceTariffIds);
      (tars || []).forEach((t: any) => sourceTariffNameMap.set(t.id, t.name));
    }

    // 2. For each rule, find eligible users and classify
    const allActions: UserAction[] = [];

    for (const rule of rules) {
      const ruleEnriched = {
        ...rule,
        _sourceProductName: rule.product_id ? sourceProductNameMap.get(rule.product_id) || null : null,
        _sourceTariffName: rule.tariff_id ? sourceTariffNameMap.get(rule.tariff_id) || null : null,
      };
      const actions = await processRule(
        supabase, ruleEnriched, !!recalculate_existing, user_ids, target_product_ids, reconcileMode,
      );
      allActions.push(...actions);
    }

    // Stage 4: extra-access detector (per-user scan, additive pass).
    // Scans active entitlements on target products that were touched by the rules
    // above; if no rule covers user×product AND no paid window justifies the
    // current expiry → classify as extra-access. Read-only here; execute is
    // gated by allow_revoke_or_expire_access + selection.
    const extraActions = await detectExtraAccessActions(
      supabase, rules, allActions, reconcileMode, user_ids,
    );
    allActions.push(...extraActions);

    // 3. Summary
    const summary = {
      total: allActions.length,
      missing_access: allActions.filter(a => a.category === "missing_access").length,
      aligned_update_needed: allActions.filter(a => a.category === "aligned_update_needed").length,
      reducible_by_rule: allActions.filter(a => a.category === "reducible_by_rule").length,
      requires_manual_review: allActions.filter(a => a.category === "requires_manual_review").length,
      conflict_existing: allActions.filter(a => a.category === "conflict_existing").length,
      already_satisfied: allActions.filter(a => a.category === "already_satisfied").length,
      condition_not_met: allActions.filter(a => a.category === "condition_not_met").length,
      no_source_window: allActions.filter(a => a.category === "no_source_window").length,
      // Stage 5: окно не вычислено даже с fallback — пользователь должен решить
      expired_source_window: allActions.filter(a => a.category === "expired_source_window").length,
      // Stage 5: сколько действий было «спасено» fallback'ом по tariff.access_days
      window_fallback_applied: allActions.filter(a => a.window_resolved_from === "tariff_access_days").length,
      // Stage 3 new categories
      relink_source_rule: allActions.filter(a => a.category === "relink_source_rule").length,
      replace_system_or_manual_lineage: allActions.filter(a => a.category === "replace_system_or_manual_lineage").length,
      telegram_action_required: allActions.filter(a => a.category === "telegram_action_required").length,
      // Stage 4 extra-access categories
      soft_expire_extra_access: allActions.filter(a => a.category === "soft_expire_extra_access").length,
      revoke_extra_access: allActions.filter(a => a.category === "revoke_extra_access").length,
      manual_review_ambiguous_source: allActions.filter(a => a.category === "manual_review_ambiguous_source").length,
      manual_review_paid_access_exists: allActions.filter(a => a.category === "manual_review_paid_access_exists").length,
    };

    // 4. STOP-guards for execute mode
    if (mode === "execute") {
      const hasSelection = (selected_action_ids && selected_action_ids.length > 0);
      const hasCategories = (apply_categories && apply_categories.length > 0);
      const isTargetedExecute = hasSelection || hasCategories || body.force_execute;

      if (!isTargetedExecute) {
        const stopReasons: string[] = [];
        if (summary.missing_access > 200) {
          stopReasons.push(`too_many_missing:${summary.missing_access}`);
        }
        if (summary.conflict_existing > 0) {
          stopReasons.push(`conflicts_detected:${summary.conflict_existing}`);
        }
        if (summary.no_source_window > 0) {
          stopReasons.push(`no_source_window:${summary.no_source_window}`);
        }
        if (stopReasons.length > 0) {
          return jsonResp({
            error: "stop_guard_triggered",
            stop_reasons: stopReasons,
            summary,
            mode: "blocked",
            actions: allActions,
          }, 400);
        }
      }
    }

    // 5. Execute if requested
    let executed: any = { created: 0, updated: 0, skipped: 0 };
    if (mode === "execute") {
      executed = await executeActions(supabase, allActions, rules, {
        recalculateExisting: !!recalculate_existing,
        allowReduceAccess: !!allow_reduce_access,
        allowRevokeOrExpire,
        allowManualOverride,
        reconcileMode,
        selectedActionIds: selected_action_ids || [],
        applyCategories: apply_categories || [],
        forceExecute: !!body.force_execute,
        callerUserId,
      });
    }

    return jsonResp({
      mode,
      reconcile_mode: reconcileMode,
      caller_user_id: callerUserId,
      rules_found: rules.length,
      rules: rules.map((r: any) => ({
        id: r.id,
        grant_target_type: r.grant_target_type,
        target_label: r.target_label,
        source_product_name: r.product_id ? sourceProductNameMap.get(r.product_id) || null : null,
        source_tariff_name: r.tariff_id ? sourceTariffNameMap.get(r.tariff_id) || null : null,
      })),
      summary,
      executed: mode === "execute" ? executed : undefined,
      actions: allActions,
    });
  } catch (err) {
    console.error("rules-retroapply error:", err);
    return jsonResp({ error: String(err) }, 500);
  }
});

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function emptySummary() {
  return {
    total: 0, missing_access: 0, aligned_update_needed: 0, reducible_by_rule: 0,
    requires_manual_review: 0, conflict_existing: 0, already_satisfied: 0,
    condition_not_met: 0, no_source_window: 0, expired_source_window: 0,
    relink_source_rule: 0, replace_system_or_manual_lineage: 0, telegram_action_required: 0,
    soft_expire_extra_access: 0, revoke_extra_access: 0,
    manual_review_ambiguous_source: 0, manual_review_paid_access_exists: 0,
    window_fallback_applied: 0,
  };
}

// ═══════ RESOLVE RULES ═══════

async function resolveRules(
  supabase: any,
  scope: { rule_ids?: string[]; source_product_id?: string; source_tariff_id?: string; changed_since?: string },
) {
  let query = supabase
    .from("access_rules")
    .select("id, grant_target_type, target_ref, target_label, product_id, tariff_id, duration_days, conditions, priority, is_active, updated_at")
    .eq("is_active", true);

  if (scope.rule_ids?.length) {
    query = query.in("id", scope.rule_ids);
  } else if (scope.source_tariff_id) {
    query = query.eq("tariff_id", scope.source_tariff_id);
  } else if (scope.source_product_id) {
    query = query.eq("product_id", scope.source_product_id);
  }

  const { data: rules, error } = await query;
  if (error) throw new Error(`Failed to fetch rules: ${error.message}`);

  let filtered = rules || [];
  if (scope.changed_since) {
    const since = new Date(scope.changed_since).toISOString();
    filtered = filtered.filter((r: any) => r.updated_at >= since);
  }

  return filtered.filter((r: any) => ["product_access", "club"].includes(r.grant_target_type));
}

// ═══════ PROCESS SINGLE RULE ═══════

async function processRule(
  supabase: any,
  rule: any,
  recalculateExisting: boolean,
  filterUserIds?: string[],
  filterTargetProductIds?: string[],
  reconcileMode: ReconcileMode = "nightly_safe",
): Promise<UserAction[]> {
  const actions: UserAction[] = [];
  const conditions = rule.conditions || {};

  const sourceProductId = rule.product_id;
  const sourceTariffId = rule.tariff_id;

  if (!sourceProductId) return actions;

  let targetProductIds: string[] =
    rule.grant_target_type === "product_access"
      ? (Array.isArray(conditions.target_product_ids)
          ? conditions.target_product_ids
          : rule.target_ref ? [rule.target_ref] : [])
      : rule.grant_target_type === "club"
        ? (rule.target_ref ? [rule.target_ref] : [])
        : [];

  if (targetProductIds.length === 0) return actions;

  // Apply target_product_ids filter if provided
  if (filterTargetProductIds?.length) {
    const filterSet = new Set(filterTargetProductIds);
    targetProductIds = targetProductIds.filter(id => filterSet.has(id));
    if (targetProductIds.length === 0) return actions;
  }

  const productInfoMap = new Map<string, { code: string; name: string }>();
  if (rule.grant_target_type === "product_access") {
    const { data: prods } = await supabase
      .from("products_v2")
      .select("id, code, name")
      .in("id", targetProductIds);
    (prods || []).forEach((p: any) => productInfoMap.set(p.id, { code: p.code || "", name: p.name || "" }));
  }

  let subsQuery = supabase
    .from("subscriptions_v2")
    .select("id, user_id, product_id, tariff_id, access_end_at, access_start_at, created_at, status")
    .eq("product_id", sourceProductId)
    .in("status", ["active", "past_due"]);

  if (sourceTariffId) {
    subsQuery = subsQuery.eq("tariff_id", sourceTariffId);
  }

  const { data: subscriptions, error: subsErr } = await subsQuery;
  if (subsErr) throw new Error(`Failed to fetch subscriptions: ${subsErr.message}`);
  if (!subscriptions?.length) return actions;

  const userSubMap = new Map<string, any>();
  for (const sub of subscriptions) {
    const existing = userSubMap.get(sub.user_id);
    if (!existing || (sub.access_end_at && (!existing.access_end_at || sub.access_end_at > existing.access_end_at))) {
      userSubMap.set(sub.user_id, sub);
    }
  }

  // Apply user_ids filter if provided (prevents full-scan timeouts)
  let userIds = [...userSubMap.keys()];
  if (filterUserIds?.length) {
    const filterSet = new Set(filterUserIds);
    userIds = userIds.filter(id => filterSet.has(id));
    if (userIds.length === 0) return actions;
  }

  // Stage 5: load tariff.access_days for fallback window resolution when
  // sub.access_end_at is empty and rule has no duration_days.
  const tariffIdSet = new Set<string>();
  for (const uid of userIds) {
    const sub = userSubMap.get(uid);
    if (sub?.tariff_id) tariffIdSet.add(sub.tariff_id);
  }
  const tariffAccessDaysMap = new Map<string, number>();
  if (tariffIdSet.size > 0) {
    const { data: tariffRows } = await supabase
      .from("tariffs")
      .select("id, access_days")
      .in("id", [...tariffIdSet]);
    (tariffRows || []).forEach((t: any) => {
      if (t.access_days && Number(t.access_days) > 0) {
        tariffAccessDaysMap.set(t.id, Number(t.access_days));
      }
    });
  }

  // Batch fetch profiles with full_name
  const profileMap = new Map<string, { id: string; email: string; full_name: string | null }>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, email, full_name")
      .in("user_id", batch);
    (profiles || []).forEach((p: any) => profileMap.set(p.user_id, {
      id: p.id,
      email: p.email || "",
      full_name: p.full_name || null,
    }));
  }

  const durationMode = rule.duration_days ? "fixed_days" : "from_source";

  const makeAction = (
    userId: string,
    targetProdId: string,
    category: string,
    plannedExpiry: string | null,
    currentExpiry: string | null,
    sub: any,
    skipReason: string | null,
    extras?: {
      lineage_will_be_overridden?: boolean;
      current_lineage?: "manual_admin" | "system" | "none" | null;
      window_resolved_from?: UserAction["window_resolved_from"];
      window_anchor_source?: UserAction["window_anchor_source"];
    },
  ): UserAction => {
    const profile = profileMap.get(userId);
    return {
      action_id: `${userId}:${targetProdId}:${rule.id}:${category}`,
      user_id: userId,
      profile_id: profile?.id || null,
      email: profile?.email || "",
      full_name: profile?.full_name || null,
      rule_id: rule.id,
      rule_target_type: rule.grant_target_type,
      rule_target_label: rule.target_label || null,
      rule_source_product_name: rule._sourceProductName || null,
      rule_source_tariff_name: rule._sourceTariffName || null,
      rule_duration_mode: durationMode,
      rule_duration_days: rule.duration_days || null,
      target_product_id: targetProdId,
      target_product_code: productInfoMap.get(targetProdId)?.code || "",
      target_product_name: productInfoMap.get(targetProdId)?.name || "",
      category,
      planned_expires_at: plannedExpiry,
      current_expires_at: currentExpiry,
      source_subscription_id: sub?.id || null,
      skip_reason: skipReason,
      lineage_will_be_overridden: extras?.lineage_will_be_overridden || false,
      current_lineage: extras?.current_lineage ?? null,
      window_resolved_from: extras?.window_resolved_from ?? null,
      window_anchor_source: extras?.window_anchor_source ?? null,
    };
  };

  /**
   * Stage 5: трёхуровневый резолвер окна:
   *   1) rule.duration_days  → planned = now + N дней, anchor=rule_duration_now
   *   2) sub.access_end_at   → planned = sub.access_end_at, anchor=sub_access_end_at
   *   3) tariff.access_days  → planned = anchor + access_days,
   *      anchor ∈ {sub.access_start_at, sub.created_at}.
   *      Never use now() as anchor for this fallback — это могло бы
   *      искусственно продлить доступ.
   */
  const resolveWindow = (sub: any): {
    plannedIso: string | null;
    window_resolved_from: UserAction["window_resolved_from"];
    window_anchor_source: UserAction["window_anchor_source"];
  } => {
    if (rule.duration_days) {
      return {
        plannedIso: new Date(Date.now() + rule.duration_days * 86400000).toISOString(),
        window_resolved_from: "rule_duration",
        window_anchor_source: "rule_duration_now",
      };
    }
    if (sub?.access_end_at) {
      return {
        plannedIso: sub.access_end_at,
        window_resolved_from: "source_access_end_at",
        window_anchor_source: "sub_access_end_at",
      };
    }
    const accessDays = sub?.tariff_id ? tariffAccessDaysMap.get(sub.tariff_id) : undefined;
    if (accessDays && accessDays > 0) {
      const anchorIso = sub.access_start_at || sub.created_at || null;
      if (anchorIso) {
        const anchorMs = new Date(anchorIso).getTime();
        if (Number.isFinite(anchorMs) && anchorMs > 0) {
          return {
            plannedIso: new Date(anchorMs + accessDays * 86400000).toISOString(),
            window_resolved_from: "tariff_access_days",
            window_anchor_source: sub.access_start_at ? "sub_access_start_at" : "sub_created_at",
          };
        }
      }
    }
    return { plannedIso: null, window_resolved_from: null, window_anchor_source: null };
  };

  if (rule.grant_target_type === "product_access") {
    for (const targetProdId of targetProductIds) {
      // Fetch ALL active entitlements per user for this target
      const existingListMap = new Map<string, any[]>();
      for (let i = 0; i < userIds.length; i += 50) {
        const batch = userIds.slice(i, i + 50);
        const { data: ents } = await supabase
          .from("entitlements")
          .select("id, user_id, expires_at, status, meta, product_id")
          .eq("product_id", targetProdId)
          .eq("status", "active")
          .in("user_id", batch);
        (ents || []).forEach((e: any) => {
          const list = existingListMap.get(e.user_id) || [];
          list.push(e);
          existingListMap.set(e.user_id, list);
        });
      }

      const hasPriorPurchase = conditions.condition_type === "prior_purchase";

      for (const userId of userIds) {
        const sub = userSubMap.get(userId)!;
        const existingList = existingListMap.get(userId) || [];
        const existing = existingList.length === 1 ? existingList[0] : null;

        // Stage 5: трёхуровневый резолвер окна (rule_duration → access_end_at → tariff.access_days)
        const win = resolveWindow(sub);
        const plannedExpiry = win.plannedIso;
        const windowExtras = {
          window_resolved_from: win.window_resolved_from,
          window_anchor_source: win.window_anchor_source,
        };

        if (hasPriorPurchase) {
          const conditionMet = await checkRetroCondition(supabase, conditions, userId, targetProdId);
          if (!conditionMet) {
            actions.push(makeAction(userId, targetProdId, "condition_not_met", plannedExpiry, null, sub, "prior_purchase_not_found", windowExtras));
            continue;
          }
        }

        if (!plannedExpiry) {
          // Все три источника пусты — нечего применять.
          actions.push(makeAction(userId, targetProdId, "no_source_window", null, null, sub,
            "no_access_end_at_no_duration_no_tariff_anchor", windowExtras));
          continue;
        }

        // Stage 5: если получившийся plannedExpiry уже в прошлом — это валидный сигнал,
        // что источник окна устарел. Не создаём/не продлеваем доступ автоматически.
        const plannedMs = new Date(plannedExpiry).getTime();
        if (Number.isFinite(plannedMs) && plannedMs < Date.now()) {
          actions.push(makeAction(userId, targetProdId, "expired_source_window", plannedExpiry,
            existing?.expires_at ?? null, sub, "planned_window_already_in_past", windowExtras));
          continue;
        }

        if (existingList.length === 0) {
          actions.push(makeAction(userId, targetProdId, "missing_access", plannedExpiry, null, sub, null, windowExtras));
        } else if (existingList.length > 1) {
          actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry,
            existingList[0].expires_at, sub, "conflict_multiple_entitlements", windowExtras));
        } else {
          // Exactly 1 active entitlement — classify
          const ent = existing!;
          const currentEnd = ent.expires_at ? new Date(ent.expires_at).getTime() : null;
          const plannedEnd = plannedExpiry ? new Date(plannedExpiry).getTime() : null;

          if (currentEnd && plannedEnd && Math.abs(currentEnd - plannedEnd) < 60000) {
            actions.push(makeAction(userId, targetProdId, "already_satisfied", plannedExpiry, ent.expires_at, sub, null));
            continue;
          }

          if (!plannedEnd) {
            actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub, "conflict_no_planned_expiry"));
            continue;
          }

          const entMeta = ent.meta || {};
          const metaBatchId = String(entMeta.batch_id || "");
          const metaRetro = entMeta.retroapply || entMeta.retroapply_updated || entMeta.retroapply_reactivated;
          const metaSourceType = String(entMeta.source_type || "").toLowerCase();
          const metaGrantedBy = String(entMeta.granted_by || "").toLowerCase();

          // Lineage detection — manual/admin vs system
          const isManualLineage =
            metaSourceType === "manual" || metaSourceType === "admin" || metaSourceType === "cohort_repair"
            || metaSourceType === "admin_edit" || metaSourceType.startsWith("manual_")
            || metaGrantedBy.includes("manual") || metaGrantedBy.includes("admin")
            || !!entMeta.manual_access_edit_last_at || !!entMeta.actor_user_id
            || !!entMeta.granted_by_admin;
          const isSystemLineage = !isManualLineage && (
            !!metaRetro
            || metaSourceType === "rule_engine" || metaSourceType === "retroapply"
            || metaSourceType === "fulfillment" || metaSourceType === "batch"
            || metaGrantedBy.startsWith("rule_engine") || metaGrantedBy === "primary_order_fulfillment"
            || metaBatchId.startsWith("BACKFILL") || metaBatchId.startsWith("RETROAPPLY")
            || !!entMeta.source_rule_id
          );
          const currentLineage: "manual_admin" | "system" | "none" =
            isManualLineage ? "manual_admin" : (isSystemLineage ? "system" : "none");

          const entSourceRuleId = entMeta.source_rule_id || null;
          const isRuleLineageSafe = !entSourceRuleId || entSourceRuleId === rule.id;

          // ─── Manual/admin lineage handling ───
          if (isManualLineage) {
            if (reconcileMode === "nightly_safe") {
              // Nightly: НЕ трогаем manual/admin записи
              actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub,
                "conflict_manual_source", { current_lineage: "manual_admin" }));
              continue;
            }
            // admin_canonicalize_all: возможно переопределить ручную lineage по правилу
            actions.push(makeAction(userId, targetProdId, "replace_system_or_manual_lineage", plannedExpiry, ent.expires_at, sub,
              "human_lineage_overridden_by_admin_canonicalize",
              { lineage_will_be_overridden: true, current_lineage: "manual_admin" }));
            continue;
          }

          // ─── Unknown lineage (нет ни manual, ни system маркеров) ───
          // В nightly_safe такие записи НЕ трогаем — нет уверенности в их природе.
          // В admin_canonicalize_all админ явно берёт ответственность → разрешаем канонизацию.
          if (!isSystemLineage && !isManualLineage) {
            if (reconcileMode === "nightly_safe") {
              actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub,
                "conflict_unknown_lineage", { current_lineage: "none" }));
              continue;
            }
            // admin_canonicalize_all: трактуем как replace (lineage будет проштампована)
            actions.push(makeAction(userId, targetProdId, "replace_system_or_manual_lineage", plannedExpiry, ent.expires_at, sub,
              "human_lineage_overridden_by_admin_canonicalize",
              { lineage_will_be_overridden: true, current_lineage: "none" }));
            continue;
          }


          // ─── System lineage with different rule ───
          if (!isRuleLineageSafe) {
            // Дата та же — это просто перепривязка к актуальному правилу
            if (currentEnd && plannedEnd && Math.abs(currentEnd - plannedEnd) < 60000) {
              actions.push(makeAction(userId, targetProdId, "relink_source_rule", plannedExpiry, ent.expires_at, sub,
                "relink_to_current_rule_same_window", { current_lineage: "system" }));
              continue;
            }
            // Иначе — будет relink + extend/reduce; в обоих режимах это безопасно (system lineage)
            // Падаем дальше в стандартную extend/reduce ветку
          }

          if (currentEnd && plannedEnd < currentEnd) {
            actions.push(makeAction(userId, targetProdId, "reducible_by_rule", plannedExpiry, ent.expires_at, sub,
              "reducible_by_canonical_rule", { current_lineage: currentLineage }));
            continue;
          }

          if (!currentEnd) {
            if (recalculateExisting) {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, null, sub,
                "safe_recalculate_expires_missing", { current_lineage: currentLineage }));
            } else {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, null, sub,
                "safe_recalculate_available_but_disabled", { current_lineage: currentLineage }));
            }
            continue;
          }

          if (plannedEnd > currentEnd) {
            if (recalculateExisting) {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, ent.expires_at, sub,
                "safe_recalculate_expires_extended", { current_lineage: currentLineage }));
            } else {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, ent.expires_at, sub,
                "safe_recalculate_available_but_disabled", { current_lineage: currentLineage }));
            }
            continue;
          }

          actions.push(makeAction(userId, targetProdId, "already_satisfied", plannedExpiry, ent.expires_at, sub,
            null, { current_lineage: currentLineage }));
        }
      }
    }
  }

  if (rule.grant_target_type === "club") {
    // Stage 3: club preview = telegram_action_required (read-only, no Telegram API)
    // Для каждого user с активной source-подпиской выпускаем preview-action.
    // Execute по club по-прежнему НЕ выполняется в этом engine.
    for (const targetClubId of targetProductIds) {
      for (const userId of userIds) {
        const sub = userSubMap.get(userId);
        if (!sub) continue;
        let plannedExpiry: string | null = null;
        if (rule.duration_days) {
          plannedExpiry = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
        } else if (sub.access_end_at) {
          plannedExpiry = sub.access_end_at;
        }
        actions.push(makeAction(userId, targetClubId, "telegram_action_required", plannedExpiry, null, sub,
          "club_grant_requires_telegram_action", { current_lineage: null }));
      }
    }
  }

  return actions;
}

// ═══════ STAGE 4 — EXTRA-ACCESS DETECTOR ═══════

/**
 * Stage 4 — per-user scan of active entitlements on target products.
 *
 * For each (user_id, target_product_id) seen in `existingActions`:
 *   1. Fetch all active entitlements for that product/user.
 *   2. Determine if any active rule covers user×product (from the input rule set
 *      AND any other active product_access rule for that target product).
 *   3. Fetch paid window: orders_v2.status='paid' and active subscriptions_v2
 *      where the user has direct purchase of the target product OR a parent
 *      that grants it (we use direct purchase as the safe proxy here; bonus
 *      windows from foreign rules are out of scope for this pass).
 *   4. Classify via shared classifier.
 *
 * Returns synthetic UserAction objects with `action_id = "extra:{ent_id}"`.
 * The execute loop honors NEVER_EXECUTE for manual_review_* and gates
 * soft_expire/revoke on the destructive flags + lineage protection.
 */
async function detectExtraAccessActions(
  supabase: any,
  rules: any[],
  existingActions: UserAction[],
  reconcileMode: ReconcileMode,
  filterUserIds?: string[],
): Promise<UserAction[]> {
  const out: UserAction[] = [];

  // 1. Build user×product index from existing actions (rule-driven scope).
  type Key = string;
  const k = (u: string, p: string): Key => `${u}::${p}`;
  const seen = new Map<Key, UserAction>();
  for (const a of existingActions) {
    if (a.rule_target_type !== "product_access") continue;
    if (!a.user_id || !a.target_product_id) continue;
    const key = k(a.user_id, a.target_product_id);
    if (!seen.has(key)) seen.set(key, a);
  }
  if (seen.size === 0) return out;

  const allUserIds = [...new Set([...seen.values()].map(a => a.user_id))];
  const userIds = filterUserIds?.length
    ? allUserIds.filter(u => filterUserIds.includes(u))
    : allUserIds;
  const targetProductIds = [...new Set([...seen.values()].map(a => a.target_product_id))];
  if (!userIds.length || !targetProductIds.length) return out;

  // 2. Fetch active entitlements for all (user, target_product) pairs.
  type EntRow = {
    id: string; user_id: string; product_id: string;
    expires_at: string | null; status: string; meta: any;
  };
  const ents: EntRow[] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    const { data } = await supabase
      .from("entitlements")
      .select("id, user_id, product_id, expires_at, status, meta")
      .in("user_id", batch)
      .in("product_id", targetProductIds)
      .eq("status", "active");
    (data || []).forEach((e: EntRow) => ents.push(e));
  }
  if (!ents.length) return out;

  // 3. Build rule-coverage index: which (user, product) pairs are covered
  //    by ANY action in the rule-driven pass with category != condition_not_met / no_source_window.
  //    These are entitlements that the rule engine WOULD have granted/extended/satisfied.
  const coveredByRule = new Set<Key>();
  const coveringRuleId = new Map<Key, string>();
  const COVERING_CATEGORIES = new Set([
    "missing_access", "aligned_update_needed", "already_satisfied",
    "reducible_by_rule", "relink_source_rule", "replace_system_or_manual_lineage",
  ]);
  for (const a of existingActions) {
    if (a.rule_target_type !== "product_access") continue;
    if (!COVERING_CATEGORIES.has(a.category)) continue;
    const key = k(a.user_id, a.target_product_id);
    coveredByRule.add(key);
    if (!coveringRuleId.has(key)) coveringRuleId.set(key, a.rule_id);
  }

  // 4. Paid windows: orders_v2.status='paid' direct purchases of the target product.
  //    SOT: orders_v2 (one-time + paid recurring); we use max(meta.access_end_at, paid_at + access_days)
  //    as available; here we simply take orders.meta.access_end_at when present, fallback to created_at.
  const paidByKey = new Map<Key, PaidWindow[]>();
  const { data: ordersRaw } = await supabase
    .from("orders_v2")
    .select("id, user_id, product_id, status, paid_at, meta, created_at")
    .eq("status", "paid")
    .in("user_id", userIds)
    .in("product_id", targetProductIds);
  for (const o of (ordersRaw || []) as any[]) {
    if (!o.user_id || !o.product_id) continue;
    const key = k(o.user_id, o.product_id);
    const list = paidByKey.get(key) || [];
    let endMs: number | null = null;
    const accessEnd = o.meta?.access_end_at || o.meta?.access_ends_at;
    if (accessEnd) endMs = new Date(accessEnd).getTime();
    else if (o.paid_at) endMs = new Date(o.paid_at).getTime();
    list.push({ end_ms: endMs, source: "order", source_id: o.id });
    paidByKey.set(key, list);
  }
  const { data: subsRaw } = await supabase
    .from("subscriptions_v2")
    .select("id, user_id, product_id, access_end_at, status")
    .in("status", ["active", "past_due"])
    .in("user_id", userIds)
    .in("product_id", targetProductIds);
  for (const s of (subsRaw || []) as any[]) {
    if (!s.user_id || !s.product_id) continue;
    const key = k(s.user_id, s.product_id);
    const list = paidByKey.get(key) || [];
    list.push({
      end_ms: s.access_end_at ? new Date(s.access_end_at).getTime() : null,
      source: "subscription", source_id: s.id,
    });
    paidByKey.set(key, list);
  }

  // 5. Product info for labels.
  const prodInfo = new Map<string, { code: string; name: string }>();
  {
    const { data } = await supabase
      .from("products_v2")
      .select("id, code, name")
      .in("id", targetProductIds);
    (data || []).forEach((p: any) => prodInfo.set(p.id, { code: p.code || "", name: p.name || "" }));
  }

  // 6. Profiles (display).
  const profileMap = new Map<string, { id: string; email: string; full_name: string | null }>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    const { data } = await supabase
      .from("profiles")
      .select("id, user_id, email, full_name")
      .in("user_id", batch);
    (data || []).forEach((p: any) => profileMap.set(p.user_id, {
      id: p.id, email: p.email || "", full_name: p.full_name || null,
    }));
  }

  const nowMs = Date.now();

  // 7. Classify each entitlement.
  for (const e of ents) {
    const key = k(e.user_id, e.product_id);
    const isCovered = coveredByRule.has(key);
    const coverage: RuleCoverage = {
      covered: isCovered,
      rule_id: isCovered ? (coveringRuleId.get(key) || null) : null,
      rule_end_ms: null,
    };
    const paid = paidByKey.get(key) || [];
    const snap: EntitlementSnapshot = {
      id: e.id, user_id: e.user_id, product_id: e.product_id,
      expires_at: e.expires_at, status: e.status, meta: e.meta || null,
    };
    const c: ExtraAccessClassification = classifyEntitlement(snap, coverage, paid, nowMs);
    if (c.category === "already_correct") continue; // not surfaced

    const profile = profileMap.get(e.user_id);
    const pinfo = prodInfo.get(e.product_id) || { code: "", name: "" };
    out.push({
      action_id: `extra:${e.id}`,
      user_id: e.user_id,
      profile_id: profile?.id || null,
      email: profile?.email || "",
      full_name: profile?.full_name || null,
      rule_id: coverage.rule_id || "",
      rule_target_type: "product_access",
      rule_target_label: pinfo.name || null,
      rule_source_product_name: null,
      rule_source_tariff_name: null,
      rule_duration_mode: "extra_access_scan",
      rule_duration_days: null,
      target_product_id: e.product_id,
      target_product_code: pinfo.code,
      target_product_name: pinfo.name,
      category: c.category,
      planned_expires_at: null,
      current_expires_at: e.expires_at,
      source_subscription_id: null,
      skip_reason: c.reason,
      current_lineage: c.lineage,
      lineage_will_be_overridden: c.human_lineage_protected && reconcileMode === "admin_canonicalize_all",
    });
  }

  return out;
}

// ═══════ CONDITION CHECK ═══════


async function checkRetroCondition(
  supabase: any,
  conditions: any,
  userId: string,
  targetProductId: string,
): Promise<boolean> {
  if (!conditions || conditions.condition_type !== "prior_purchase") return true;

  const matchMode = conditions.match_mode || "any";
  const requiredProductIds: string[] = Array.isArray(conditions.required_product_ids)
    ? conditions.required_product_ids
    : conditions.required_product_id
      ? [conditions.required_product_id]
      : [];

  const productToCheck = matchMode === "per_product" ? targetProductId
    : requiredProductIds.length > 0 ? requiredProductIds[0]
    : null;

  if (!productToCheck) return true;

  if (matchMode === "per_product") {
    // Use canonical shared resolver (direct match + module_list_mapped fallback)
    // excludeOrderId = empty string since retroapply has no "current order"
    const result = await checkPriorPurchase(supabase, userId, targetProductId, '00000000-0000-0000-0000-000000000000');
    return result.found;
  }

  for (const reqProdId of requiredProductIds) {
    const result = await checkPriorPurchase(supabase, userId, reqProdId, '00000000-0000-0000-0000-000000000000');

    if (matchMode === "any" && result.found) return true;
    if (matchMode === "all" && !result.found) return false;
  }

  return matchMode === "all";
}

// ═══════ EXECUTE ACTIONS ═══════

// Non-executable categories — NEVER updated even if selected
const NEVER_EXECUTE_CATEGORIES = new Set([
  "already_satisfied",
  "conflict_existing",
  "no_source_window",
  "condition_not_met",
  "expired_source_window", // Stage 5: окно уже в прошлом — не создаём/не продлеваем автоматически
  "telegram_action_required", // Stage 3: preview-only — execute через telegram-grant-access
  // Stage 4: extra-access preview-only review categories
  "manual_review_ambiguous_source",
  "manual_review_paid_access_exists",
]);

// Stage 4: destructive categories (soft_expire / revoke) — execute only when
// allowRevokeOrExpire + explicit selection + lineage gate is satisfied.
const EXTRA_ACCESS_DESTRUCTIVE = new Set([
  "soft_expire_extra_access",
  "revoke_extra_access",
]);

interface ExecuteOptions {
  recalculateExisting: boolean;
  allowReduceAccess: boolean;
  /** Stage 3 destructive — для soft-expire/revoke (not implemented in this stage's execute) */
  allowRevokeOrExpire: boolean;
  /** Stage 3 — позволяет execute по replace_system_or_manual_lineage */
  allowManualOverride: boolean;
  /** Stage 3 — режим reconcile */
  reconcileMode: ReconcileMode;
  selectedActionIds: string[];
  applyCategories: string[];
  forceExecute: boolean;
  callerUserId: string | null;
}

async function executeActions(
  supabase: any,
  actions: UserAction[],
  rules: any[],
  opts: ExecuteOptions,
): Promise<{
  targeted: number;
  created: number;
  reactivated: number;
  reactivation_candidates_found: number;
  updated: number;
  skipped_idempotent: number;
  skipped_conflict: number;
  skipped_error: number;
  not_selected: number;
  created_action_ids: string[];
  reactivated_action_ids: string[];
  updated_action_ids: string[];
  skipped_action_ids: string[];
  errors: Array<{ action_id: string; error: string }>;
}> {
  let targeted = 0;
  let created = 0;
  let reactivated = 0;
  let reactivation_candidates_found = 0;
  let updated = 0;
  let skipped_idempotent = 0;
  let skipped_conflict = 0;
  let skipped_error = 0;
  let not_selected = 0;
  const created_action_ids: string[] = [];
  const reactivated_action_ids: string[] = [];
  const updated_action_ids: string[] = [];
  const skipped_action_ids: string[] = [];
  const errors: Array<{ action_id: string; error: string }> = [];

  const batchId = `RETROAPPLY-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;

  const ruleMap = new Map<string, any>();
  rules.forEach(r => ruleMap.set(r.id, r));

  const selectedSet = new Set(opts.selectedActionIds);
  const hasSelection = selectedSet.size > 0;
  const categorySet = new Set(opts.applyCategories);
  const hasCategories = categorySet.size > 0;

  // Legacy force_execute: treat as safe categories
  if (opts.forceExecute && !hasSelection && !hasCategories) {
    categorySet.add("missing_access");
    categorySet.add("aligned_update_needed");
  }

  function shouldExecute(action: UserAction): boolean {
    if (NEVER_EXECUTE_CATEGORIES.has(action.category)) return false;

    if (action.category === "requires_manual_review") {
      return hasSelection && selectedSet.has(action.action_id);
    }

    if (action.category === "reducible_by_rule") {
      if (!opts.allowReduceAccess) return false;
      if (hasSelection && selectedSet.has(action.action_id)) return true;
      if (hasCategories && categorySet.has("reducible_by_rule")) return true;
      return false;
    }

    if (action.category === "aligned_update_needed") {
      const skipReason = action.skip_reason || "";
      if (skipReason === "safe_recalculate_available_but_disabled") return false;
      if (hasSelection) return selectedSet.has(action.action_id);
      if (hasCategories) return categorySet.has("aligned_update_needed");
      return true;
    }

    if (action.category === "missing_access") {
      if (hasSelection) return selectedSet.has(action.action_id);
      if (hasCategories) return categorySet.has("missing_access");
      return true;
    }

    // Stage 3: relink_source_rule — metadata-only update, безопасно при явном выборе/категории
    if (action.category === "relink_source_rule") {
      if (hasSelection && selectedSet.has(action.action_id)) return true;
      if (hasCategories && categorySet.has("relink_source_rule")) return true;
      return false;
    }

    // Stage 3: replace_system_or_manual_lineage — только в admin_canonicalize_all + allowManualOverride
    if (action.category === "replace_system_or_manual_lineage") {
      if (opts.reconcileMode !== "admin_canonicalize_all") return false;
      if (!opts.allowManualOverride) return false;
      if (hasSelection && selectedSet.has(action.action_id)) return true;
      if (hasCategories && categorySet.has("replace_system_or_manual_lineage")) return true;
      return false;
    }

    // Stage 4: destructive extra-access execute path
    if (EXTRA_ACCESS_DESTRUCTIVE.has(action.category)) {
      const isHumanLineage = action.current_lineage === "manual_admin" || action.current_lineage === "none";
      if (!opts.allowRevokeOrExpire) return false;
      if (isHumanLineage) {
        if (opts.reconcileMode !== "admin_canonicalize_all") return false;
        if (!opts.allowManualOverride) return false;
      }
      // ALWAYS require explicit selection or category opt-in
      if (hasSelection && selectedSet.has(action.action_id)) return true;
      if (hasCategories && categorySet.has(action.category)) return true;
      return false;
    }

    return false;
  }

  for (const action of actions) {
    if (!shouldExecute(action)) {
      not_selected++;
      continue;
    }


    targeted++;

    if (action.category === "missing_access") {
      // Idempotent guard: check if entitlement exists with ANY status
      // (unique constraint is on user_id + product_code, not status-specific)
      const { data: existing } = await supabase
        .from("entitlements")
        .select("id, status, expires_at, meta, profile_id")
        .eq("user_id", action.user_id)
        .eq("product_id", action.target_product_id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        if (existing.status === "active") {
          // Already active — idempotent skip
          skipped_idempotent++;
          skipped_action_ids.push(action.action_id);
          continue;
        }

        if (existing.status === "expired") {
          // Reactivation path: UPDATE expired → active
          reactivation_candidates_found++;

          const rule = ruleMap.get(action.rule_id);
          const sourceWindowRule = rule?.duration_days ? "rule_duration" : "align_with_source";

          // Meta merge: strictly add-only, preserve all existing keys
          const oldMeta = (existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta))
            ? existing.meta as Record<string, unknown>
            : {};

          // Lineage check: only manual/admin lineage is protected from auto-relink.
          // System-generated lineage (rule_engine / retroapply / fulfillment / batch) is safe to relink
          // to the currently active rule. previous_source_rule_id is recorded in meta for audit.
          const oldSourceType = String(oldMeta.source_type || "").toLowerCase();
          const oldGrantedBy = String(oldMeta.granted_by || "").toLowerCase();
          const oldBatchId = String(oldMeta.batch_id || "");
          const isManualLineage = oldSourceType === "manual" || oldSourceType === "admin"
            || oldGrantedBy.includes("manual") || oldGrantedBy.includes("admin")
            || !!oldMeta.manual_access_edit_last_at;
          const isSystemLineage = !isManualLineage && (
            !!oldMeta.retroapply || !!oldMeta.retroapply_updated || !!oldMeta.retroapply_reactivated
            || oldSourceType === "rule_engine" || oldSourceType === "retroapply"
            || oldSourceType === "fulfillment" || oldSourceType === "batch"
            || oldGrantedBy.startsWith("rule_engine") || oldGrantedBy === "primary_order_fulfillment"
            || oldBatchId.startsWith("BACKFILL") || oldBatchId.startsWith("RETROAPPLY")
            || !!oldMeta.source_rule_id
          );

          if (oldMeta.source_rule_id && oldMeta.source_rule_id !== action.rule_id) {
            if (!isSystemLineage || isManualLineage) {
              // Manual lineage with foreign source_rule_id → skip (manual review)
              skipped_error++;
              errors.push({
                action_id: action.action_id,
                error: `manual_lineage_protected: existing rule ${oldMeta.source_rule_id} kept (manual entitlement)`,
              });
              continue;
            }
            // System lineage: safe relink — proceed with reactivation, log previous rule
          }

          // Build strictly add-only patch — never overwrite existing keys
          const retroapplyPatch: Record<string, unknown> = {
            source_type: "retroapply",
            retroapply_reactivated: true,
            retroapply_reactivated_at: new Date().toISOString(),
            previous_status: "expired",
            previous_expires_at: existing.expires_at,
            batch_id: batchId,
          };
          // Relink: always set source_rule_id to current rule; preserve previous_source_rule_id for audit
          if (oldMeta.source_rule_id && oldMeta.source_rule_id !== action.rule_id) {
            retroapplyPatch.source_rule_id = action.rule_id;
            retroapplyPatch.previous_source_rule_id = oldMeta.source_rule_id;
            retroapplyPatch.relinked_at = new Date().toISOString();
            retroapplyPatch.relink_reason = "system_lineage_safe_relink";
          } else if (!oldMeta.source_rule_id) {
            retroapplyPatch.source_rule_id = action.rule_id;
          }
          if (!oldMeta.source_window_rule) retroapplyPatch.source_window_rule = sourceWindowRule;
          if (!oldMeta.business_subscription_id && action.source_subscription_id) {
            retroapplyPatch.business_subscription_id = action.source_subscription_id;
          }

          const mergedMeta = { ...oldMeta, ...retroapplyPatch };

          // Build update payload
          const updatePayload: Record<string, unknown> = {
            status: "active",
            expires_at: action.planned_expires_at,
            updated_at: new Date().toISOString(),
            meta: mergedMeta,
          };

          // Set profile_id only if currently empty
          if (!existing.profile_id) {
            let profileId = action.profile_id;
            if (!profileId) {
              const { data: prof } = await supabase
                .from("profiles")
                .select("id")
                .eq("user_id", action.user_id)
                .limit(1)
                .maybeSingle();
              profileId = prof?.id || null;
            }
            if (profileId) updatePayload.profile_id = profileId;
          }

          const { error: reactivateErr } = await supabase
            .from("entitlements")
            .update(updatePayload)
            .eq("id", existing.id);

          if (reactivateErr) {
            console.error(`Failed to reactivate entitlement ${existing.id}: ${reactivateErr.message}`);
            skipped_error++;
            errors.push({ action_id: action.action_id, error: reactivateErr.message });
          } else {
            reactivated++;
            reactivated_action_ids.push(action.action_id);
          }
          continue;
        }

        // Any other status (revoked, cancelled, manual_blocked, etc.) — unsafe, do not reactivate
        skipped_error++;
        errors.push({
          action_id: action.action_id,
          error: `unsafe_status_for_reactivation: ${existing.status}`,
        });
        continue;
      }

      // No existing entitlement — standard INSERT path
      const rule = ruleMap.get(action.rule_id);
      const sourceWindowRule = rule?.duration_days ? "rule_duration" : "align_with_source";

      const { data: prod } = await supabase
        .from("products_v2")
        .select("code")
        .eq("id", action.target_product_id)
        .maybeSingle();

      let profileId = action.profile_id;
      if (!profileId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", action.user_id)
          .limit(1)
          .maybeSingle();
        profileId = prof?.id || null;
      }

      const insertPayload: Record<string, unknown> = {
        user_id: action.user_id,
        product_id: action.target_product_id,
        product_code: prod?.code || action.target_product_code,
        status: "active",
        expires_at: action.planned_expires_at,
        meta: {
          source_type: "retroapply",
          source_rule_id: action.rule_id,
          source_window_rule: sourceWindowRule,
          batch_id: batchId,
          business_subscription_id: action.source_subscription_id,
          retroapply: true,
          window_resolved_from: action.window_resolved_from || null,
          window_anchor_source: action.window_anchor_source || null,
        },
      };
      if (profileId) insertPayload.profile_id = profileId;

      const { error: insertErr } = await supabase
        .from("entitlements")
        .insert(insertPayload);

      if (insertErr) {
        console.error(`Failed to insert entitlement for user ${action.user_id}: ${insertErr.message}`);
        skipped_error++;
        errors.push({ action_id: action.action_id, error: insertErr.message });
      } else {
        created++;
        created_action_ids.push(action.action_id);
      }
    } else if (
      action.category === "aligned_update_needed"
      || action.category === "reducible_by_rule"
      || action.category === "relink_source_rule"
      || action.category === "replace_system_or_manual_lineage"
    ) {
      // Update existing entitlement — with meta MERGE
      const { data: ent } = await supabase
        .from("entitlements")
        .select("id, meta, expires_at")
        .eq("user_id", action.user_id)
        .eq("product_id", action.target_product_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (ent) {
        const oldMeta = (ent.meta && typeof ent.meta === "object" && !Array.isArray(ent.meta))
          ? ent.meta as Record<string, unknown>
          : {};
        const previousSourceRuleId = oldMeta.source_rule_id || null;
        const mergedMeta: Record<string, unknown> = {
          ...oldMeta,
          source_rule_id: action.rule_id,
          retroapply_updated: true,
          batch_id: batchId,
          stage3_category: action.category,
          stage3_reconcile_mode: opts.reconcileMode,
        };
        if (previousSourceRuleId && previousSourceRuleId !== action.rule_id) {
          mergedMeta.previous_source_rule_id = previousSourceRuleId;
          mergedMeta.relink_reason = "stage3_relink_or_canonicalize";
        }
        if (action.category === "replace_system_or_manual_lineage") {
          mergedMeta.previous_lineage_source_type = oldMeta.source_type || null;
          mergedMeta.previous_lineage_granted_by = oldMeta.granted_by || null;
          mergedMeta.canonicalized_by_admin = true;
          mergedMeta.canonicalized_by_user_id = opts.callerUserId;
          mergedMeta.canonicalized_at = new Date().toISOString();
          mergedMeta.source_type = "retroapply";
        }
        if (action.category === "reducible_by_rule") {
          // Stage 5: сохранить предыдущий срок и причину сокращения для аудита/UI.
          mergedMeta.previous_expires_at = ent.expires_at || null;
          mergedMeta.reduction_reason = "stage5_reducible_by_canonical_rule";
          mergedMeta.reduced_at = new Date().toISOString();
          mergedMeta.reduced_by_user_id = opts.callerUserId;
        }
        if (action.window_resolved_from) {
          mergedMeta.window_resolved_from = action.window_resolved_from;
          mergedMeta.window_anchor_source = action.window_anchor_source || null;
        }

        // relink_source_rule: метаданные only, expires_at не меняем (он уже совпадает)
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          meta: mergedMeta,
        };
        if (action.category !== "relink_source_rule" && action.planned_expires_at) {
          updatePayload.expires_at = action.planned_expires_at;
        }

        const { error: updateErr } = await supabase
          .from("entitlements")
          .update(updatePayload)
          .eq("id", ent.id);

        if (updateErr) {
          console.error(`Failed to update entitlement ${ent.id}: ${updateErr.message}`);
          skipped_error++;
          errors.push({ action_id: action.action_id, error: updateErr.message });
        } else {
          updated++;
          updated_action_ids.push(action.action_id);
        }
      } else {
        skipped_conflict++;
        skipped_action_ids.push(action.action_id);
      }
    } else if (EXTRA_ACCESS_DESTRUCTIVE.has(action.category)) {
      // Stage 4: soft_expire / revoke. action_id pattern is "extra:{ent_id}".
      const entId = action.action_id.startsWith("extra:")
        ? action.action_id.substring("extra:".length)
        : null;
      if (!entId) {
        skipped_error++;
        errors.push({ action_id: action.action_id, error: "extra_action_id_malformed" });
        continue;
      }
      const { data: ent } = await supabase
        .from("entitlements")
        .select("id, status, expires_at, meta")
        .eq("id", entId)
        .maybeSingle();
      if (!ent) {
        skipped_idempotent++;
        skipped_action_ids.push(action.action_id);
        continue;
      }
      if (ent.status !== "active") {
        skipped_idempotent++;
        skipped_action_ids.push(action.action_id);
        continue;
      }
      const oldMeta = (ent.meta && typeof ent.meta === "object" && !Array.isArray(ent.meta))
        ? ent.meta as Record<string, unknown>
        : {};
      const isSoftExpire = action.category === "soft_expire_extra_access";
      const newStatus = isSoftExpire ? "expired" : "revoked";
      const metaPatch: Record<string, unknown> = {
        ...oldMeta,
        stage4_extra_access_action: action.category,
        stage4_reconcile_mode: opts.reconcileMode,
        stage4_batch_id: batchId,
        stage4_reason: action.skip_reason,
        stage4_actor_user_id: opts.callerUserId,
        stage4_applied_at: new Date().toISOString(),
        stage4_previous_status: ent.status,
        stage4_previous_expires_at: ent.expires_at,
        stage4_previous_lineage: action.current_lineage,
      };
      if (isSoftExpire) {
        metaPatch.expired_by_canonicalize = true;
      } else {
        metaPatch.revoked_by_canonicalize = true;
      }
      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString(),
        meta: metaPatch,
      };
      if (isSoftExpire) {
        // Soft-expire: clamp expires_at to now (or keep past value if already past).
        const now = new Date().toISOString();
        updatePayload.expires_at = ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()
          ? ent.expires_at
          : now;
      }
      const { error: destrErr } = await supabase
        .from("entitlements")
        .update(updatePayload)
        .eq("id", entId)
        .eq("status", "active"); // optimistic lock
      if (destrErr) {
        skipped_error++;
        errors.push({ action_id: action.action_id, error: destrErr.message });
      } else {
        updated++;
        updated_action_ids.push(action.action_id);
      }
    } else {
      skipped_conflict++;
      skipped_action_ids.push(action.action_id);
    }
  }


  await supabase.from("audit_logs").insert({
    action: "rules_retroapply.executed",
    actor_type: opts.callerUserId ? "user" : "system",
    actor_id: opts.callerUserId,
    actor_label: opts.callerUserId ? "rules-retroapply (admin)" : "rules-retroapply",
    meta: {
      batch_id: batchId,
      reconcile_mode: opts.reconcileMode,
      rule_ids: rules.map((r: any) => r.id),
      targeted,
      created,
      reactivated,
      reactivation_candidates_found,
      updated,
      skipped_idempotent,
      skipped_conflict,
      skipped_error,
      not_selected,
      total_actions: actions.length,
      // Stage 5: сколько action'ов получили окно через tariff.access_days fallback
      window_fallback_applied: actions.filter(a => a.window_resolved_from === "tariff_access_days").length,
      expired_source_window_count: actions.filter(a => a.category === "expired_source_window").length,
      execute_options: {
        recalculate_existing: opts.recalculateExisting,
        allow_reduce_access: opts.allowReduceAccess,
        allow_revoke_or_expire: opts.allowRevokeOrExpire,
        allow_manual_override: opts.allowManualOverride,
        selected_count: opts.selectedActionIds.length,
        apply_categories: opts.applyCategories,
      },
    },
  });

  return {
    targeted,
    created,
    reactivated,
    reactivation_candidates_found,
    updated,
    skipped_idempotent,
    skipped_conflict,
    skipped_error,
    not_selected,
    created_action_ids,
    reactivated_action_ids,
    updated_action_ids,
    skipped_action_ids,
    errors,
  };
}
