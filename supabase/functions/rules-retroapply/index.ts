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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RetroApplyRequest {
  mode: "preview" | "execute";
  rule_ids?: string[];
  source_product_id?: string;
  source_tariff_id?: string;
  changed_since?: string;
  recalculate_existing?: boolean;
  force_execute?: boolean; // legacy compat, treated as apply all safe categories
  // New execute controls
  allow_reduce_access?: boolean;
  selected_action_ids?: string[];
  apply_categories?: string[];
}

interface UserAction {
  action_id: string; // stable: ${user_id}:${target_product_id}:${rule_id}:${category}
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
    } = body;

    if (!mode || !["preview", "execute"].includes(mode)) {
      return jsonResp({ error: "mode must be 'preview' or 'execute'" }, 400);
    }

    if (!rule_ids?.length && !source_product_id && !source_tariff_id && !changed_since) {
      return jsonResp({ error: "At least one scope param required: rule_ids, source_product_id, source_tariff_id, changed_since" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Resolve rules
    const rules = await resolveRules(supabase, { rule_ids, source_product_id, source_tariff_id, changed_since });

    if (rules.length === 0) {
      return jsonResp({ mode, rules_found: 0, actions: [], summary: { total: 0 } });
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
      const actions = await processRule(supabase, ruleEnriched, !!recalculate_existing);
      allActions.push(...actions);
    }

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
    };

    // 4. STOP-guards for execute mode
    // conflict_existing and no_source_window block standard execute (not force/selected)
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
    let executed = { created: 0, updated: 0, skipped: 0 };
    if (mode === "execute") {
      executed = await executeActions(supabase, allActions, rules, {
        recalculateExisting: !!recalculate_existing,
        allowReduceAccess: !!allow_reduce_access,
        selectedActionIds: selected_action_ids || [],
        applyCategories: apply_categories || [],
        forceExecute: !!body.force_execute,
      });
    }

    return jsonResp({
      mode,
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
): Promise<UserAction[]> {
  const actions: UserAction[] = [];
  const conditions = rule.conditions || {};

  const sourceProductId = rule.product_id;
  const sourceTariffId = rule.tariff_id;

  if (!sourceProductId) return actions;

  const targetProductIds: string[] =
    rule.grant_target_type === "product_access"
      ? (Array.isArray(conditions.target_product_ids)
          ? conditions.target_product_ids
          : rule.target_ref ? [rule.target_ref] : [])
      : rule.grant_target_type === "club"
        ? (rule.target_ref ? [rule.target_ref] : [])
        : [];

  if (targetProductIds.length === 0) return actions;

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
    .select("id, user_id, product_id, tariff_id, access_end_at, status")
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

  const userIds = [...userSubMap.keys()];

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
      source_subscription_id: sub.id,
      skip_reason: skipReason,
    };
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

        let plannedExpiry: string | null = null;
        if (rule.duration_days) {
          plannedExpiry = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
        } else if (sub.access_end_at) {
          plannedExpiry = sub.access_end_at;
        }

        if (hasPriorPurchase) {
          const conditionMet = await checkRetroCondition(supabase, conditions, userId, targetProdId);
          if (!conditionMet) {
            actions.push(makeAction(userId, targetProdId, "condition_not_met", plannedExpiry, null, sub, "prior_purchase_not_found"));
            continue;
          }
        }

        if (!plannedExpiry && !rule.duration_days) {
          actions.push(makeAction(userId, targetProdId, "no_source_window", null, null, sub, "no_access_end_at_and_no_duration_days"));
          continue;
        }

        if (existingList.length === 0) {
          actions.push(makeAction(userId, targetProdId, "missing_access", plannedExpiry, null, sub, null));
        } else if (existingList.length > 1) {
          // Multiple active entitlements = real conflict
          actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry,
            existingList[0].expires_at, sub, "conflict_multiple_entitlements"));
        } else {
          // Exactly 1 active entitlement — classify
          const ent = existing!;
          const currentEnd = ent.expires_at ? new Date(ent.expires_at).getTime() : null;
          const plannedEnd = plannedExpiry ? new Date(plannedExpiry).getTime() : null;

          // Already satisfied (within 60s tolerance)
          if (currentEnd && plannedEnd && Math.abs(currentEnd - plannedEnd) < 60000) {
            actions.push(makeAction(userId, targetProdId, "already_satisfied", plannedExpiry, ent.expires_at, sub, null));
            continue;
          }

          // No planned expiry = conflict
          if (!plannedEnd) {
            actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub, "conflict_no_planned_expiry"));
            continue;
          }

          // Determine if source is safe — use meta fields since entitlements has no "source" column
          const entMeta = ent.meta || {};
          const metaBatchId = entMeta.batch_id || "";
          const metaRetro = entMeta.retroapply || entMeta.retroapply_updated;
          const metaSourceType = (entMeta.source_type || "").toLowerCase();
          const isSourceSafe = !!metaRetro || metaBatchId.startsWith("BACKFILL") || metaBatchId.startsWith("RETROAPPLY")
            || metaSourceType === "fulfillment" || metaSourceType === "retroapply" || metaSourceType === "batch"
            || (entMeta.source_rule_id && !metaSourceType);

          // Check meta.source_rule_id lineage
          const entSourceRuleId = entMeta.source_rule_id || null;
          const isRuleLineageSafe = !entSourceRuleId || entSourceRuleId === rule.id;

          // Manual/admin sources = real conflict
          if (!isSourceSafe) {
            actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub, "conflict_manual_source"));
            continue;
          }

          // Different rule source = real conflict
          if (!isRuleLineageSafe) {
            actions.push(makeAction(userId, targetProdId, "conflict_existing", plannedExpiry, ent.expires_at, sub, "conflict_different_rule_source"));
            continue;
          }

          // Would reduce access — NOT a blocking conflict if source is canonical
          // Instead: reducible_by_rule (admin can choose to apply)
          if (currentEnd && plannedEnd < currentEnd) {
            actions.push(makeAction(userId, targetProdId, "reducible_by_rule", plannedExpiry, ent.expires_at, sub, "reducible_by_canonical_rule"));
            continue;
          }

          // current_expires_at IS NULL and safe lineage → safe recalculate
          if (!currentEnd) {
            if (recalculateExisting) {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, null, sub, "safe_recalculate_expires_missing"));
            } else {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, null, sub, "safe_recalculate_available_but_disabled"));
            }
            continue;
          }

          // planned > current and safe → safe recalculate
          if (plannedEnd > currentEnd) {
            if (recalculateExisting) {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, ent.expires_at, sub, "safe_recalculate_expires_extended"));
            } else {
              actions.push(makeAction(userId, targetProdId, "aligned_update_needed", plannedExpiry, ent.expires_at, sub, "safe_recalculate_available_but_disabled"));
            }
            continue;
          }

          // Fallback: already satisfied (current >= planned)
          actions.push(makeAction(userId, targetProdId, "already_satisfied", plannedExpiry, ent.expires_at, sub, null));
        }
      }
    }
  }

  if (rule.grant_target_type === "club") {
    console.log(`Club rule ${rule.id} skipped in retroapply v1 — club grants require telegram integration`);
  }

  return actions;
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
    const { data } = await supabase
      .from("orders_v2")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", targetProductId)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  for (const reqProdId of requiredProductIds) {
    const { data } = await supabase
      .from("orders_v2")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", reqProdId)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle();

    if (matchMode === "any" && data) return true;
    if (matchMode === "all" && !data) return false;
  }

  return matchMode === "all";
}

// ═══════ EXECUTE ACTIONS ═══════

// Non-executable categories — NEVER updated even if selected
const NEVER_EXECUTE_CATEGORIES = new Set([
  "conflict_existing",
  "no_source_window",
  "already_satisfied",
  "condition_not_met",
]);

interface ExecuteOptions {
  recalculateExisting: boolean;
  allowReduceAccess: boolean;
  selectedActionIds: string[];
  applyCategories: string[];
  forceExecute: boolean;
}

async function executeActions(
  supabase: any,
  actions: UserAction[],
  rules: any[],
  opts: ExecuteOptions,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

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
    // Never execute blocking categories
    if (NEVER_EXECUTE_CATEGORIES.has(action.category)) return false;

    // requires_manual_review: only via explicit selection, never via apply_categories
    if (action.category === "requires_manual_review") {
      return hasSelection && selectedSet.has(action.action_id);
    }

    // reducible_by_rule: requires allow_reduce_access + (selected OR in apply_categories)
    if (action.category === "reducible_by_rule") {
      if (!opts.allowReduceAccess) return false;
      if (hasSelection && selectedSet.has(action.action_id)) return true;
      if (hasCategories && categorySet.has("reducible_by_rule")) return true;
      return false;
    }

    // aligned_update_needed: skip if recalculate disabled
    if (action.category === "aligned_update_needed") {
      const skipReason = action.skip_reason || "";
      if (skipReason === "safe_recalculate_available_but_disabled") return false;
      // If targeted execute, check membership
      if (hasSelection) return selectedSet.has(action.action_id);
      if (hasCategories) return categorySet.has("aligned_update_needed");
      return true; // default execute
    }

    // missing_access
    if (action.category === "missing_access") {
      if (hasSelection) return selectedSet.has(action.action_id);
      if (hasCategories) return categorySet.has("missing_access");
      return true; // default execute
    }

    return false;
  }

  for (const action of actions) {
    if (!shouldExecute(action)) {
      skipped++;
      continue;
    }

    if (action.category === "missing_access") {
      // Idempotent guard: check if entitlement appeared between preview and execute
      const { data: existing } = await supabase
        .from("entitlements")
        .select("id")
        .eq("user_id", action.user_id)
        .eq("product_id", action.target_product_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const rule = ruleMap.get(action.rule_id);
      const sourceWindowRule = rule?.duration_days ? "rule_duration" : "align_with_source";

      const { data: prod } = await supabase
        .from("products_v2")
        .select("code")
        .eq("id", action.target_product_id)
        .maybeSingle();

      const { error: insertErr } = await supabase
        .from("entitlements")
        .insert({
          user_id: action.user_id,
          product_id: action.target_product_id,
          product_code: prod?.code || action.target_product_code,
          status: "active",
          source: "retroapply",
          expires_at: action.planned_expires_at,
          meta: {
            source_rule_id: action.rule_id,
            source_window_rule: sourceWindowRule,
            batch_id: batchId,
            business_subscription_id: action.source_subscription_id,
            retroapply: true,
          },
        });

      if (insertErr) {
        console.error(`Failed to insert entitlement for user ${action.user_id}: ${insertErr.message}`);
        skipped++;
      } else {
        created++;
      }
    } else if (action.category === "aligned_update_needed" || action.category === "reducible_by_rule") {
      // Update existing entitlement
      const { data: ent } = await supabase
        .from("entitlements")
        .select("id")
        .eq("user_id", action.user_id)
        .eq("product_id", action.target_product_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (ent && action.planned_expires_at) {
        const { error: updateErr } = await supabase
          .from("entitlements")
          .update({
            expires_at: action.planned_expires_at,
            updated_at: new Date().toISOString(),
            meta: {
              source_rule_id: action.rule_id,
              retroapply_updated: true,
              batch_id: batchId,
            },
          })
          .eq("id", ent.id);

        if (updateErr) {
          console.error(`Failed to update entitlement ${ent.id}: ${updateErr.message}`);
          skipped++;
        } else {
          updated++;
        }
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  await supabase.from("audit_logs").insert({
    action: "rules_retroapply.executed",
    actor_type: "system",
    actor_label: "rules-retroapply",
    meta: {
      batch_id: batchId,
      rule_ids: rules.map((r: any) => r.id),
      created,
      updated,
      skipped,
      total_actions: actions.length,
      execute_options: {
        recalculate_existing: opts.recalculateExisting,
        allow_reduce_access: opts.allowReduceAccess,
        selected_count: opts.selectedActionIds.length,
        apply_categories: opts.applyCategories,
      },
    },
  });

  return { created, updated, skipped };
}
