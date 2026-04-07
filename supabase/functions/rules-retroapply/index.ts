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
 *   missing_access        — no entitlement, will create
 *   aligned_update_needed — entitlement exists but expires_at misaligned
 *   conflict_existing     — entitlement exists, different rule, skip
 *   already_satisfied     — entitlement correct, skip
 *   condition_not_met     — prior_purchase condition failed, skip
 *   no_source_window      — align_with_source but no subscription found, conflict
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RetroApplyRequest {
  mode: "preview" | "execute";
  // Scope: at least one required
  rule_ids?: string[];
  source_product_id?: string;
  source_tariff_id?: string;
  changed_since?: string;
  // Options
  recalculate_existing?: boolean; // default false — only grant missing
  force_execute?: boolean; // override STOP-guards after preview review
}

interface UserAction {
  user_id: string;
  profile_id: string | null;
  email: string;
  rule_id: string;
  rule_target_type: string;
  target_product_id: string;
  target_product_code: string;
  target_product_name: string;
  category:
    | "missing_access"
    | "aligned_update_needed"
    | "conflict_existing"
    | "already_satisfied"
    | "condition_not_met"
    | "no_source_window";
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
    const { mode, rule_ids, source_product_id, source_tariff_id, changed_since, recalculate_existing } = body;

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

    // 2. For each rule, find eligible users and classify
    const allActions: UserAction[] = [];

    for (const rule of rules) {
      const actions = await processRule(supabase, rule, !!recalculate_existing);
      allActions.push(...actions);
    }

    // 3. Summary
    const summary = {
      total: allActions.length,
      missing_access: allActions.filter(a => a.category === "missing_access").length,
      aligned_update_needed: allActions.filter(a => a.category === "aligned_update_needed").length,
      conflict_existing: allActions.filter(a => a.category === "conflict_existing").length,
      already_satisfied: allActions.filter(a => a.category === "already_satisfied").length,
      condition_not_met: allActions.filter(a => a.category === "condition_not_met").length,
      no_source_window: allActions.filter(a => a.category === "no_source_window").length,
    };

    // 4. STOP-guards for execute mode
    if (mode === "execute") {
      const stopReasons: string[] = [];
      if (summary.missing_access > 200) {
        stopReasons.push(`Too many missing_access: ${summary.missing_access} (limit 200). Run preview first.`);
      }
      if (summary.conflict_existing > 0) {
        stopReasons.push(`${summary.conflict_existing} conflict(s) detected. Review before executing.`);
      }
      if (summary.no_source_window > 0) {
        stopReasons.push(`${summary.no_source_window} user(s) with no source window. Cannot determine expiry.`);
      }
      if (stopReasons.length > 0 && !body.force_execute) {
        return jsonResp({
          error: "STOP-guard triggered. Add force_execute: true to override after reviewing.",
          stop_reasons: stopReasons,
          summary,
          mode: "blocked",
          actions: allActions,
        }, 400);
      }
    }

    // 5. Execute if requested
    let executed = { created: 0, updated: 0, skipped: 0 };
    if (mode === "execute") {
      executed = await executeActions(supabase, allActions, rules);
    }

    return jsonResp({
      mode,
      rules_found: rules.length,
      rules: rules.map(r => ({ id: r.id, grant_target_type: r.grant_target_type, target_label: r.target_label })),
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

  // Only product_access and club rules are retroapply-able (training_content is visibility-only)
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

  // Determine source product/tariff for finding eligible users
  const sourceProductId = rule.product_id;
  const sourceTariffId = rule.tariff_id;

  if (!sourceProductId) return actions;

  // Determine target product IDs
  const targetProductIds: string[] =
    rule.grant_target_type === "product_access"
      ? (Array.isArray(conditions.target_product_ids)
          ? conditions.target_product_ids
          : rule.target_ref ? [rule.target_ref] : [])
      : rule.grant_target_type === "club"
        ? (rule.target_ref ? [rule.target_ref] : [])
        : [];

  if (targetProductIds.length === 0) return actions;

  // Resolve target product info
  const productInfoMap = new Map<string, { code: string; name: string }>();
  if (rule.grant_target_type === "product_access") {
    const { data: prods } = await supabase
      .from("products_v2")
      .select("id, code, name")
      .in("id", targetProductIds);
    (prods || []).forEach((p: any) => productInfoMap.set(p.id, { code: p.code || "", name: p.name || "" }));
  }

  // Find eligible users: those with active/past_due subscription on source product
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

  // Deduplicate by user_id, keep latest access_end_at
  const userSubMap = new Map<string, any>();
  for (const sub of subscriptions) {
    const existing = userSubMap.get(sub.user_id);
    if (!existing || (sub.access_end_at && (!existing.access_end_at || sub.access_end_at > existing.access_end_at))) {
      userSubMap.set(sub.user_id, sub);
    }
  }

  const userIds = [...userSubMap.keys()];

  // Batch fetch profiles for emails
  const profileMap = new Map<string, { id: string; email: string }>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, email")
      .in("user_id", batch);
    (profiles || []).forEach((p: any) => profileMap.set(p.user_id, { id: p.id, email: p.email || "" }));
  }

  // For product_access rules: check existing entitlements
  if (rule.grant_target_type === "product_access") {
    for (const targetProdId of targetProductIds) {
      // Batch fetch existing entitlements for this target product
      const existingMap = new Map<string, any>();
      for (let i = 0; i < userIds.length; i += 50) {
        const batch = userIds.slice(i, i + 50);
        const { data: ents } = await supabase
          .from("entitlements")
          .select("id, user_id, expires_at, status, meta, product_id")
          .eq("product_id", targetProdId)
          .eq("status", "active")
          .in("user_id", batch);
        (ents || []).forEach((e: any) => existingMap.set(e.user_id, e));
      }

      // Check prior_purchase condition if needed
      const hasPriorPurchase = conditions.condition_type === "prior_purchase";

      for (const userId of userIds) {
        const sub = userSubMap.get(userId)!;
        const profile = profileMap.get(userId);
        const existing = existingMap.get(userId);

        // Resolve expected expires_at
        let plannedExpiry: string | null = null;
        if (rule.duration_days) {
          plannedExpiry = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
        } else if (sub.access_end_at) {
          plannedExpiry = sub.access_end_at;
        }

        // Check prior_purchase condition
        if (hasPriorPurchase) {
          const conditionMet = await checkRetroCondition(supabase, conditions, userId, targetProdId);
          if (!conditionMet) {
            actions.push({
              user_id: userId,
              profile_id: profile?.id || null,
              email: profile?.email || "",
              rule_id: rule.id,
              rule_target_type: rule.grant_target_type,
              target_product_id: targetProdId,
              target_product_code: productInfoMap.get(targetProdId)?.code || "",
              target_product_name: productInfoMap.get(targetProdId)?.name || "",
              category: "condition_not_met",
              planned_expires_at: plannedExpiry,
              current_expires_at: null,
              source_subscription_id: sub.id,
              skip_reason: "prior_purchase_not_found",
            });
            continue;
          }
        }

        if (!plannedExpiry && !rule.duration_days) {
          // No source window and no duration_days — conflict
          actions.push({
            user_id: userId,
            profile_id: profile?.id || null,
            email: profile?.email || "",
            rule_id: rule.id,
            rule_target_type: rule.grant_target_type,
            target_product_id: targetProdId,
            target_product_code: productInfoMap.get(targetProdId)?.code || "",
            target_product_name: productInfoMap.get(targetProdId)?.name || "",
            category: "no_source_window",
            planned_expires_at: null,
            current_expires_at: null,
            source_subscription_id: sub.id,
            skip_reason: "no_access_end_at_and_no_duration_days",
          });
          continue;
        }

        if (!existing) {
          // Missing access — will create
          actions.push({
            user_id: userId,
            profile_id: profile?.id || null,
            email: profile?.email || "",
            rule_id: rule.id,
            rule_target_type: rule.grant_target_type,
            target_product_id: targetProdId,
            target_product_code: productInfoMap.get(targetProdId)?.code || "",
            target_product_name: productInfoMap.get(targetProdId)?.name || "",
            category: "missing_access",
            planned_expires_at: plannedExpiry,
            current_expires_at: null,
            source_subscription_id: sub.id,
            skip_reason: null,
          });
        } else {
          // Existing entitlement — check alignment
          const currentEnd = existing.expires_at ? new Date(existing.expires_at).getTime() : null;
          const plannedEnd = plannedExpiry ? new Date(plannedExpiry).getTime() : null;

          if (currentEnd && plannedEnd && Math.abs(currentEnd - plannedEnd) < 60000) {
            // Within 1 minute tolerance — aligned
            actions.push({
              user_id: userId,
              profile_id: profile?.id || null,
              email: profile?.email || "",
              rule_id: rule.id,
              rule_target_type: rule.grant_target_type,
              target_product_id: targetProdId,
              target_product_code: productInfoMap.get(targetProdId)?.code || "",
              target_product_name: productInfoMap.get(targetProdId)?.name || "",
              category: "already_satisfied",
              planned_expires_at: plannedExpiry,
              current_expires_at: existing.expires_at,
              source_subscription_id: sub.id,
              skip_reason: null,
            });
          } else if (recalculateExisting && plannedEnd && currentEnd && plannedEnd > currentEnd) {
            // Recalculate mode: update if planned > current
            actions.push({
              user_id: userId,
              profile_id: profile?.id || null,
              email: profile?.email || "",
              rule_id: rule.id,
              rule_target_type: rule.grant_target_type,
              target_product_id: targetProdId,
              target_product_code: productInfoMap.get(targetProdId)?.code || "",
              target_product_name: productInfoMap.get(targetProdId)?.name || "",
              category: "aligned_update_needed",
              planned_expires_at: plannedExpiry,
              current_expires_at: existing.expires_at,
              source_subscription_id: sub.id,
              skip_reason: null,
            });
          } else {
            // Conflict or already satisfied
            actions.push({
              user_id: userId,
              profile_id: profile?.id || null,
              email: profile?.email || "",
              rule_id: rule.id,
              rule_target_type: rule.grant_target_type,
              target_product_id: targetProdId,
              target_product_code: productInfoMap.get(targetProdId)?.code || "",
              target_product_name: productInfoMap.get(targetProdId)?.name || "",
              category: currentEnd && plannedEnd && currentEnd >= plannedEnd
                ? "already_satisfied"
                : "conflict_existing",
              planned_expires_at: plannedExpiry,
              current_expires_at: existing.expires_at,
              source_subscription_id: sub.id,
              skip_reason: currentEnd && plannedEnd && currentEnd >= plannedEnd
                ? null
                : "existing_entitlement_from_different_source",
            });
          }
        }
      }
    }
  }

  // Club rules are similar but target telegram_clubs — simplified for now
  if (rule.grant_target_type === "club") {
    // Club retroapply would check telegram_club_members — out of scope for v1
    // Log as info
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

  // per_product mode: check if user has prior purchase of the target product itself
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

  // any/all mode
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

async function executeActions(
  supabase: any,
  actions: UserAction[],
  rules: any[],
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const batchId = `RETROAPPLY-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;

  const ruleMap = new Map<string, any>();
  rules.forEach(r => ruleMap.set(r.id, r));

  for (const action of actions) {
    if (action.category === "missing_access") {
      const rule = ruleMap.get(action.rule_id);
      const sourceWindowRule = rule?.duration_days ? "rule_duration" : "align_with_source";

      // Idempotency check: re-verify no active entitlement exists
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

      // Resolve product_code
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
    } else if (action.category === "aligned_update_needed") {
      // Update expires_at
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

  // Audit log
  await supabase.from("audit_logs").insert({
    action: "rules_retroapply.executed",
    actor_type: "system",
    actor_label: "rules-retroapply",
    meta: {
      batch_id: batchId,
      rule_ids: rules.map(r => r.id),
      created,
      updated,
      skipped,
      total_actions: actions.length,
    },
  });

  return { created, updated, skipped };
}
