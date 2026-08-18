import { checkPriorPurchase } from './check-prior-purchase.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  resolveProductAccessRules,
  syncSecondaryProductAccessForUser,
  type SecondaryGrantAction,
} from './product-access-grants.ts';

type SupabaseQueryClient = {
  from: (relation: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClubRule = {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  duration_days: number | null;
  conditions: Record<string, unknown> | null;
};

export type ClubBonusSourceSyncResult = {
  status: 'not_configured' | 'condition_not_met' | 'inserted' | 'exists';
  access_rule_id?: string;
  source_id?: string;
  source_ref?: string;
  product_id?: string;
  tariff_id?: string;
  starts_at?: string;
  expires_at?: string;
};

function configuredTargetTariffId(rule: ClubRule): string | null {
  const value = rule.conditions?.grant_tariff_id;
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function configuredDurationDays(rule: ClubRule): number | null {
  const value = Number(rule.duration_days);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function conditionMatches(
  supabase: SupabaseQueryClient,
  rule: ClubRule,
  userId: string,
  orderId: string,
): Promise<boolean> {
  const conditions = rule.conditions || {};
  if (!conditions.condition_type) return true;
  if (conditions.condition_type !== 'prior_purchase') return false;

  const requiredIds = Array.isArray(conditions.required_product_ids)
    ? conditions.required_product_ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    : typeof conditions.required_product_id === 'string' && UUID_RE.test(conditions.required_product_id)
      ? [conditions.required_product_id]
      : [];
  const requiredTariffId = typeof conditions.required_tariff_id === 'string' && UUID_RE.test(conditions.required_tariff_id)
    ? conditions.required_tariff_id
    : undefined;

  if (requiredIds.length === 0) return false;
  const matchMode = conditions.match_mode === 'all' ? 'all' : 'any';
  const checks = await Promise.all(
    requiredIds.map(id => checkPriorPurchase(supabase, userId, id, orderId, requiredTariffId)),
  );
  return matchMode === 'all'
    ? checks.every(check => check.found)
    : checks.some(check => check.found);
}

async function loadConfiguredRules(
  supabase: SupabaseQueryClient,
  productId: string,
  tariffId: string | null,
): Promise<ClubRule[]> {
  const select = 'id, product_id, tariff_id, duration_days, conditions';
  const rules: ClubRule[] = [];

  if (tariffId) {
    const { data, error } = await supabase
      .from('access_rules')
      .select(select)
      .eq('tariff_id', tariffId)
      .eq('grant_target_type', 'club')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(`club_bonus_tariff_rules_failed:${error.message}`);
    rules.push(...((data || []) as ClubRule[]));
  }

  const { data, error } = await supabase
    .from('access_rules')
    .select(select)
    .eq('product_id', productId)
    .is('tariff_id', null)
    .eq('grant_target_type', 'club')
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`club_bonus_product_rules_failed:${error.message}`);
  rules.push(...((data || []) as ClubRule[]));

  return rules;
}

/**
 * Create the independently expiring Club bonus configured by an access rule.
 *
 * Rules without a finite duration or conditions.grant_tariff_id remain
 * Telegram-only and are intentionally ignored for backwards compatibility.
 * The database RPC performs the paid-order, scope, target-product and target-
 * tariff validation again and owns idempotency.
 */
export async function syncConfiguredClubBonusSource(
  supabase: SupabaseQueryClient,
  params: {
    orderId: string;
    userId: string;
    productId: string;
    tariffId: string | null;
  },
): Promise<ClubBonusSourceSyncResult> {
  const rules = await loadConfiguredRules(supabase, params.productId, params.tariffId);
  const configured = rules.filter(rule =>
    configuredDurationDays(rule) !== null && configuredTargetTariffId(rule) !== null
  );
  if (configured.length === 0) return { status: 'not_configured' };

  for (const rule of configured) {
    if (!await conditionMatches(supabase, rule, params.userId, params.orderId)) continue;

    const { data, error } = await supabase.rpc('upsert_club_bonus_entitlement_source', {
      p_order_id: params.orderId,
      p_access_rule_id: rule.id,
    });
    if (error) throw new Error(`club_bonus_source_upsert_failed:${error.message}`);

    const result = (data || {}) as Record<string, unknown>;
    const status = result.status === 'exists' ? 'exists' : 'inserted';
    return {
      status,
      access_rule_id: rule.id,
      source_id: typeof result.source_id === 'string'
        ? result.source_id
        : undefined,
      source_ref: typeof result.source_ref === 'string' ? result.source_ref : undefined,
      product_id: typeof result.product_id === 'string' ? result.product_id : undefined,
      tariff_id: typeof result.tariff_id === 'string' ? result.tariff_id : undefined,
      starts_at: typeof result.starts_at === 'string' ? result.starts_at : undefined,
      expires_at: typeof result.expires_at === 'string' ? result.expires_at : undefined,
    };
  }

  return { status: 'condition_not_met' };
}

export type ClubBonusCascadeSyncResult = ClubBonusSourceSyncResult & {
  product_access: SecondaryGrantAction[];
};

/**
 * Create/repair the finite Club bonus and immediately apply the access rules
 * of the granted Club tariff. This closes the gap where a course purchase
 * created a valid Club entitlement but never restored the buyer's historical
 * products that BUSINESS/IDEOLOGY explicitly unlock through prior_purchase.
 */
export async function syncConfiguredClubBonusCascade(
  supabase: SupabaseClient,
  params: {
    orderId: string;
    userId: string;
    profileId?: string | null;
    productId: string;
    tariffId: string | null;
    sourceEventKeyPrefix: string;
  },
): Promise<ClubBonusCascadeSyncResult> {
  const source = await syncConfiguredClubBonusSource(supabase, params);
  if (
    (source.status !== 'inserted' && source.status !== 'exists')
    || !source.source_id
    || !source.product_id
    || !source.tariff_id
    || !source.expires_at
  ) {
    return { ...source, product_access: [] };
  }

  const rules = await resolveProductAccessRules(
    supabase,
    source.product_id,
    source.tariff_id,
  );
  if (rules.length === 0) return { ...source, product_access: [] };

  const productAccess = await syncSecondaryProductAccessForUser(supabase, {
    userId: params.userId,
    profileId: params.profileId || null,
    sourceProductId: source.product_id,
    sourceTariffId: source.tariff_id,
    sourceSubscription: null,
    sourceEntitlementSource: {
      id: source.source_id,
      access_end_at: source.expires_at,
    },
    rules,
    excludeOrderId: params.orderId,
    ctx: {
      sourceEventType: 'webhook',
      sourceSubjectType: 'order',
      sourceEventKeyPrefix: params.sourceEventKeyPrefix,
      orderId: params.orderId,
      allowReduceAccess: false,
    },
  });

  return { ...source, product_access: productAccess };
}
