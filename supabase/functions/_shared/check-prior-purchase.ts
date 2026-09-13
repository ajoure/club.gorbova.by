/**
 * check-prior-purchase.ts — единый канонический resolver для проверки prior_purchase.
 *
 * Контракт:
 * - Все решения ТОЛЬКО по UUID (product_id, module_list_mapped UUID)
 * - Запрещено: сравнения по product_code, slug, name, legacy codes
 * - Два уровня проверки:
 *   1. Прямой match: orders_v2.product_id = targetProductId
 *   2. Fallback: purchase_snapshot.module_list_mapped содержит targetProductId
 *      Только явные UUID-компоненты известных типов исторической покупки.
 *      Split-child и несколько явно перечисленных UUID не требуют дублирующего заказа.
 *
 * Используется в:
 * - access-resolver.ts (secondary grants resolution)
 * - grant-access-for-order/index.ts (per-product prior purchase check)
 */

import { HISTORICAL_COMPONENT_TYPES, hasHistoricalComponent, isModuleOnlyHistory } from './historical-component-purchase.ts';

type SupabaseQueryClient = {
  from: (relation: string) => any;
};

export interface PriorPurchaseResult {
  found: boolean;
  order_id: string | null;
  match_type: 'direct' | 'module_list_mapped' | null;
  /** The prior order row (id, tariff_id, purchase_snapshot) when found */
  order_data: {
    id: string;
    tariff_id: string | null;
    purchase_snapshot: Record<string, any> | null;
  } | null;
}

/**
 * Check if user has a prior paid order for a specific product.
 *
 * @param supabase - Supabase client (service role)
 * @param userId - auth.users UUID
 * @param targetProductId - UUID of the product to check for prior purchase
 * @param excludeOrderId - order to exclude from the search (current order)
 * @param requiredTariffId - optional UUID of the exact historical tariff
 * @param profileId - optional profiles.id for legacy/profile-only orders
 */
export async function checkPriorPurchase(
  supabase: SupabaseQueryClient,
  userId: string,
  targetProductId: string,
  excludeOrderId: string,
  requiredTariffId?: string,
  profileId?: string | null,
): Promise<PriorPurchaseResult> {
  const NOT_FOUND: PriorPurchaseResult = {
    found: false,
    order_id: null,
    match_type: null,
    order_data: null,
  };

  const profileIds = new Set<string>();
  if (profileId) profileIds.add(profileId);
  const { data: linkedProfiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId);
  if (profileErr) {
    console.error('[check-prior-purchase] Profile identity query error:', profileErr.message);
  }
  for (const profile of linkedProfiles || []) {
    if (profile.id) profileIds.add(profile.id);
  }

  const queryOrders = async (
    channel: 'user_id' | 'profile_id',
    value: string | string[],
    moduleFallback: boolean,
  ) => {
    let query = supabase
      .from('orders_v2')
      .select('id, tariff_id, purchase_snapshot')
      .eq('status', 'paid')
      .not('is_deleted', 'is', true)
      .neq('id', excludeOrderId);

    query = Array.isArray(value)
      ? query.in(channel, value)
      : query.eq(channel, value);

    if (moduleFallback) {
      query = query
        .in('purchase_snapshot->>historical_purchase_type', HISTORICAL_COMPONENT_TYPES)
        .contains('purchase_snapshot', { module_list_mapped: [targetProductId] });
    } else {
      query = query.eq('product_id', targetProductId);
    }
    if (requiredTariffId) query = query.eq('tariff_id', requiredTariffId);
    const data: any[] = [];
    for (let from = 0; ; from += 1000) {
      const response = await query.order('id').range(from, from + 999);
      if (response.error) return response;
      data.push(...(response.data || []));
      if ((response.data || []).length < 1000) return { data, error: null };
    }
  };

  // Step 1: direct match through either canonical user_id or the linked profile.
  const directResults = await Promise.all([
    queryOrders('user_id', userId, false),
    ...(profileIds.size > 0
      ? [queryOrders('profile_id', [...profileIds], false)]
      : []),
  ]);
  const directOrders: any[] = [];
  for (const response of directResults) {
    if (response.error) {
      console.error('[check-prior-purchase] Direct query error:', response.error.message);
      continue;
    }
    directOrders.push(...(response.data || []));
  }

  // A split child carrying the parent tariff is still only a module purchase.
  const directOrder = directOrders.find((o: any) => o.tariff_id && !isModuleOnlyHistory(o.purchase_snapshot?.historical_purchase_type))
    || directOrders[0]
    || null;

  if (directOrder) {
    return {
      found: true,
      order_id: directOrder.id,
      match_type: 'direct',
      order_data: {
        id: directOrder.id,
        tariff_id: directOrder.tariff_id,
        purchase_snapshot: directOrder.purchase_snapshot as Record<string, any> | null,
      },
    };
  }

  // Step 2: Fallback — check module_list_mapped in purchase_snapshot
  // Only explicitly mapped UUID components of supported historical purchase types.
  // Use JSONB containment for efficient server-side filtering
  const moduleResults = await Promise.all([
    queryOrders('user_id', userId, true),
    ...(profileIds.size > 0
      ? [queryOrders('profile_id', [...profileIds], true)]
      : []),
  ]);
  const moduleOrders: any[] = [];
  for (const response of moduleResults) {
    if (response.error) {
      console.error('[check-prior-purchase] Module fallback query error:', response.error.message);
      continue;
    }
    moduleOrders.push(...(response.data || []));
  }

  for (const order of (moduleOrders || [])) {
    const snapshot = order.purchase_snapshot as Record<string, any> | null;
    if (!snapshot) continue;

    if (!hasHistoricalComponent(snapshot, targetProductId)) continue;

    return {
      found: true,
      order_id: order.id,
      match_type: 'module_list_mapped' as const,
      order_data: {
        id: order.id,
        tariff_id: order.tariff_id,
        purchase_snapshot: snapshot,
      },
    };
  }

  return NOT_FOUND;
}
