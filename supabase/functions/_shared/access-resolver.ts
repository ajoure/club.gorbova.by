/**
 * access-resolver.ts — единый resolver доступа (SoT: access_rules + ID-связи)
 * 
 * Контракт:
 * - Все решения принимаются ТОЛЬКО по ID (product_id, tariff_id, offer_id, order_id)
 * - Запрещено: решения по product_code, slug, name, description
 * - Единственный источник правил: таблица access_rules (is_active = true)
 * - Функция read-only: не создаёт entitlements/subscriptions, только возвращает решение
 * 
 * Используется в:
 * - grant-access-for-order (primary + secondary grants)
 * - repair-cb20-entitlements (mechanical executor)
 * - runtime visibility (useTrainingContentRules)
 */

import { checkPriorPurchase } from "./check-prior-purchase.ts";

export interface AccessResolutionInput {
  order_id: string;
  product_id: string;
  tariff_id: string | null;
  offer_id?: string | null;
  user_id: string;
  profile_id?: string | null;
}

export interface PrimaryGrant {
  product_id: string;
  product_code: string;
  expires_at: string | null;
  source_rule: 'paid_order';
}

export interface SecondaryGrant {
  product_id: string;
  product_code: string;
  expires_at: string | null;
  rule_id: string;
  rule_type: 'club' | 'product_access';
  granted_by: 'rule_engine_product_access' | 'rule_engine_club';
  conditions: Record<string, any> | null;
  // For product_access with prior_purchase: whether condition was met
  condition_met?: boolean;
  skip_reason?: string;
  // Enriched meta for write-side
  enriched_meta?: Record<string, any>;
}

export interface ClubGrant {
  club_id: string;
  rule_id: string;
  granted_by: 'rule_engine_club';
}

export interface TrainingContentFilter {
  root_module_id: string;
  access_mode: 'full' | 'partial';
  allowed_module_ids: string[];
  allowed_lesson_ids: string[];
  rule_id: string;
  /**
   * Month-gate: если true — runtime-видимость урока/модуля должна
   * дополнительно проверять checkMonthPurchase(user, rule.tariff_id, content_month).
   * Применяется ТОЛЬКО для контента с заполненным content_month.
   */
  match_purchase_month: boolean;
  /** tariff_id правила (нужен для проверки month-gate). null = любой тариф продукта. */
  rule_tariff_id: string | null;
}

export interface AccessResolution {
  primary_grant: PrimaryGrant;
  club_grants: ClubGrant[];
  secondary_grants: SecondaryGrant[];
  training_content_filters: TrainingContentFilter[];
  blocked_reasons: string[];
}

/**
 * Resolve all access grants for a given order.
 * 
 * CRITICAL: This function does NOT make decisions based on product_code/name/slug.
 * All lookups are by ID. product_code is only resolved for snapshot/meta purposes.
 */
export async function resolveAccessForOrder(
  supabase: any,
  input: AccessResolutionInput,
): Promise<AccessResolution> {
  const { order_id, product_id, tariff_id, user_id } = input;

  const result: AccessResolution = {
    primary_grant: {
      product_id,
      product_code: '',
      expires_at: null,
      source_rule: 'paid_order',
    },
    club_grants: [],
    secondary_grants: [],
    training_content_filters: [],
    blocked_reasons: [],
  };

  // 1. Resolve product_code for the primary product (snapshot only, not for decisions)
  const { data: primaryProduct } = await supabase
    .from('products_v2')
    .select('code, name, entitlement_mode')
    .eq('id', product_id)
    .maybeSingle();

  if (!primaryProduct) {
    result.blocked_reasons.push(`product_not_found:${product_id}`);
    return result;
  }
  result.primary_grant.product_code = primaryProduct.code || '';

  // 2. Resolve club grants from access_rules
  const clubGrants = await resolveClubGrants(supabase, product_id, tariff_id, user_id, order_id);
  result.club_grants = clubGrants;

  // 3. Resolve product_access grants from access_rules
  const secondaryGrants = await resolveProductAccessGrants(
    supabase, product_id, tariff_id, user_id, order_id,
  );
  result.secondary_grants = secondaryGrants;

  // 4. Resolve training_content filters from access_rules
  const trainingFilters = await resolveTrainingContentFilters(supabase, product_id, tariff_id);
  result.training_content_filters = trainingFilters;

  return result;
}

/**
 * Resolve club grants from access_rules (type = 'club').
 * Priority: tariff-level rules first, then product-level.
 */
async function resolveClubGrants(
  supabase: any,
  productId: string,
  tariffId: string | null,
  userId: string,
  orderId: string,
): Promise<ClubGrant[]> {
  const grants: ClubGrant[] = [];

  // Tariff-level rules (highest priority)
  if (tariffId) {
    const { data: tariffRules } = await supabase
      .from('access_rules')
      .select('id, target_ref, conditions')
      .eq('tariff_id', tariffId)
      .eq('grant_target_type', 'club')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (tariffRules?.length) {
      for (const rule of tariffRules) {
        const conditionOk = await checkPriorPurchaseCondition(supabase, rule.conditions, userId, orderId);
        if (conditionOk && rule.target_ref) {
          grants.push({
            club_id: rule.target_ref,
            rule_id: rule.id,
            granted_by: 'rule_engine_club',
          });
          break; // Only first matching club rule
        }
      }
    }
  }

  // Product-level rules (fallback if no tariff rules matched)
  if (grants.length === 0) {
    const { data: productRules } = await supabase
      .from('access_rules')
      .select('id, target_ref, conditions')
      .eq('product_id', productId)
      .is('tariff_id', null)
      .eq('grant_target_type', 'club')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (productRules?.length) {
      for (const rule of productRules) {
        const conditionOk = await checkPriorPurchaseCondition(supabase, rule.conditions, userId, orderId);
        if (conditionOk && rule.target_ref) {
          grants.push({
            club_id: rule.target_ref,
            rule_id: rule.id,
            granted_by: 'rule_engine_club',
          });
          break;
        }
      }
    }
  }

  return grants;
}

/**
 * Resolve product_access grants from access_rules.
 * Handles multi-product rules and per_product prior_purchase conditions.
 */
async function resolveProductAccessGrants(
  supabase: any,
  productId: string,
  tariffId: string | null,
  userId: string,
  orderId: string,
): Promise<SecondaryGrant[]> {
  const grants: SecondaryGrant[] = [];

  // Collect applicable rules (tariff-level first, then product-level)
  let rules: any[] = [];

  if (tariffId) {
    const { data: tariffRules } = await supabase
      .from('access_rules')
      .select('id, target_ref, conditions, priority, duration_days')
      .eq('tariff_id', tariffId)
      .eq('grant_target_type', 'product_access')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    if (tariffRules?.length) rules = tariffRules;
  }

  if (rules.length === 0) {
    const { data: prodRules } = await supabase
      .from('access_rules')
      .select('id, target_ref, conditions, priority, duration_days')
      .eq('product_id', productId)
      .is('tariff_id', null)
      .eq('grant_target_type', 'product_access')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    if (prodRules?.length) rules = prodRules;
  }

  for (const rule of rules) {
    const ruleConditions = rule.conditions || {};

    // Resolve target product IDs
    const targetProductIds: string[] = Array.isArray(ruleConditions.target_product_ids)
      ? ruleConditions.target_product_ids
      : (rule.target_ref ? [rule.target_ref] : []);

    if (targetProductIds.length === 0) continue;

    const hasPriorPurchaseCondition = ruleConditions.condition_type === 'prior_purchase';
    let conditionProductIds: string[] = [];
    if (hasPriorPurchaseCondition) {
      conditionProductIds = Array.isArray(ruleConditions.required_product_ids)
        ? ruleConditions.required_product_ids
        : (ruleConditions.required_product_id ? [ruleConditions.required_product_id] : []);

      if (conditionProductIds.length === 0 && ruleConditions.match_mode === 'per_product') {
        conditionProductIds = targetProductIds;
      }
    }

    // Resolve expires_at
    let expiresAt: string | null = null;
    let sourceWindowRule = 'default';

    if (rule.duration_days) {
      expiresAt = new Date(Date.now() + rule.duration_days * 86400000).toISOString();
      sourceWindowRule = 'rule_duration';
    } else {
      // align_with_source: use triggering subscription's access_end_at
      const { data: sourceSub } = await supabase
        .from('subscriptions_v2')
        .select('id, access_end_at, tariff_id')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .in('status', ['active', 'past_due'])
        .order('access_end_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sourceSub?.access_end_at) {
        expiresAt = sourceSub.access_end_at;
        sourceWindowRule = 'align_with_source';
      }
    }

    for (const targetProdId of targetProductIds) {
      // Per-product prior purchase check
      if (hasPriorPurchaseCondition) {
        const productToCheck = conditionProductIds.includes(targetProdId) ? targetProdId : null;

        if (productToCheck) {
          // Use canonical shared resolver (direct match + module_list_mapped fallback)
          const priorResult = await checkPriorPurchase(supabase, userId, productToCheck, orderId);

          if (!priorResult.found) {
            grants.push({
              product_id: targetProdId,
              product_code: '', // Will be resolved by executor
              expires_at: expiresAt,
              rule_id: rule.id,
              rule_type: 'product_access',
              granted_by: 'rule_engine_product_access',
              conditions: ruleConditions,
              condition_met: false,
              skip_reason: 'no_prior_purchase',
            });
            continue;
          }

          // Resolve scope from historical purchase
          const priorOrder = priorResult.order_data!;
          const snapshot = (priorOrder.purchase_snapshot || {}) as Record<string, any>;
          const historicalPurchaseType = snapshot.historical_purchase_type ||
            (priorOrder.tariff_id ? 'base_tariff_purchase' : 'module_only_standalone');
          const historicalTariffId = priorOrder.tariff_id || snapshot.tariff_id || null;
          const historicalModuleProductIds = Array.isArray(snapshot.module_list_mapped)
            ? snapshot.module_list_mapped : [];

          let scopeResolutionMode = 'full_tariff_scope';
          if (historicalPurchaseType === 'module_only_standalone' || historicalPurchaseType === 'module_child_purchase') {
            scopeResolutionMode = historicalModuleProductIds.length > 0 ? 'module_scope_only' : 'manual_review';
          } else if (priorOrder.tariff_id) {
            scopeResolutionMode = 'full_tariff_scope';
          } else {
            scopeResolutionMode = 'no_scope';
          }

          grants.push({
            product_id: targetProdId,
            product_code: '',
            expires_at: expiresAt,
            rule_id: rule.id,
            rule_type: 'product_access',
            granted_by: 'rule_engine_product_access',
            conditions: ruleConditions,
            condition_met: true,
            enriched_meta: {
              granted_by: 'rule_engine_product_access',
              source_rule_id: rule.id,
              source_order_id: orderId,
              historical_purchase_type: historicalPurchaseType,
              historical_tariff_id: historicalTariffId,
              historical_module_product_ids: historicalModuleProductIds,
              scope_resolution_mode: scopeResolutionMode,
              source_window_rule: sourceWindowRule,
              prior_purchase_match_type: priorResult.match_type,
              prior_purchase_order_id: priorResult.order_id,
            },
          });
        } else {
          grants.push({
            product_id: targetProdId,
            product_code: '',
            expires_at: expiresAt,
            rule_id: rule.id,
            rule_type: 'product_access',
            granted_by: 'rule_engine_product_access',
            conditions: ruleConditions,
            condition_met: false,
            skip_reason: 'not_in_condition_list',
          });
        }
      } else {
        // No prior purchase condition — unconditional grant
        grants.push({
          product_id: targetProdId,
          product_code: '',
          expires_at: expiresAt,
          rule_id: rule.id,
          rule_type: 'product_access',
          granted_by: 'rule_engine_product_access',
          conditions: ruleConditions,
          condition_met: true,
          enriched_meta: {
            granted_by: 'rule_engine_product_access',
            source_rule_id: rule.id,
            source_order_id: orderId,
            scope_resolution_mode: 'full_tariff_scope',
            source_window_rule: sourceWindowRule,
          },
        });
      }
    }
  }

  // Resolve product_codes for all grants (snapshot only)
  const grantProductIds = [...new Set(grants.map(g => g.product_id))];
  if (grantProductIds.length > 0) {
    const { data: products } = await supabase
      .from('products_v2')
      .select('id, code')
      .in('id', grantProductIds);

    const codeMap = new Map<string, string>();
    (products || []).forEach((p: any) => codeMap.set(p.id, p.code));
    grants.forEach(g => {
      g.product_code = codeMap.get(g.product_id) || '';
    });
  }

  return grants;
}

/**
 * Resolve training_content filters from access_rules.
 */
async function resolveTrainingContentFilters(
  supabase: any,
  productId: string,
  tariffId: string | null,
): Promise<TrainingContentFilter[]> {
  const filters: TrainingContentFilter[] = [];

  // Get training_content rules for this product
  let query = supabase
    .from('access_rules')
    .select('id, target_ref, conditions, tariff_id')
    .eq('product_id', productId)
    .eq('grant_target_type', 'training_content')
    .eq('is_active', true);

  const { data: rules } = await query;

  if (!rules?.length) return filters;

  // If tariff_id is set, prefer tariff-specific rule
  const tariffRule = tariffId ? rules.find((r: any) => r.tariff_id === tariffId) : null;
  const productRule = rules.find((r: any) => !r.tariff_id);
  const bestRule = tariffRule || productRule;

  if (bestRule) {
    const cond = bestRule.conditions || {};
    filters.push({
      root_module_id: bestRule.target_ref,
      access_mode: cond.access_mode || 'full',
      allowed_module_ids: cond.allowed_module_ids || [],
      allowed_lesson_ids: cond.allowed_lesson_ids || [],
      rule_id: bestRule.id,
      match_purchase_month: cond.match_purchase_month === true,
      rule_tariff_id: bestRule.tariff_id ?? null,
    });
  }

  return filters;
}

/**
 * Check prior_purchase condition from rule.conditions.
 * Returns true if no condition or condition is met.
 */
async function checkPriorPurchaseCondition(
  supabase: any,
  conditions: any,
  userId: string,
  orderId: string,
): Promise<boolean> {
  if (!conditions) return true;
  if (conditions.condition_type !== 'prior_purchase') return true;

  const requiredProductId = conditions.required_product_id;
  if (!requiredProductId) return true;

  const { data: priorOrder } = await supabase
    .from('orders_v2')
    .select('id')
    .eq('user_id', userId)
    .eq('product_id', requiredProductId)
    .eq('status', 'paid')
    .neq('id', orderId)
    .limit(1)
    .maybeSingle();

  return !!priorOrder;
}
