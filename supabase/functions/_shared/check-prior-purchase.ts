/**
 * check-prior-purchase.ts — единый канонический resolver для проверки prior_purchase.
 *
 * Контракт:
 * - Все решения ТОЛЬКО по UUID (product_id, module_list_mapped UUID)
 * - Запрещено: сравнения по product_code, slug, name, legacy codes
 * - Два уровня проверки:
 *   1. Прямой match: orders_v2.product_id = targetProductId
 *   2. Fallback: purchase_snapshot.module_list_mapped содержит targetProductId
 *      ТОЛЬКО для historical_purchase_type = 'module_only_standalone'
 *      ТОЛЬКО если module_list_mapped.length === 1 (однозначный маппинг)
 *
 * Используется в:
 * - access-resolver.ts (secondary grants resolution)
 * - grant-access-for-order/index.ts (per-product prior purchase check)
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
 */
export async function checkPriorPurchase(
  supabase: SupabaseClient,
  userId: string,
  targetProductId: string,
  excludeOrderId: string,
): Promise<PriorPurchaseResult> {
  const NOT_FOUND: PriorPurchaseResult = {
    found: false,
    order_id: null,
    match_type: null,
    order_data: null,
  };

  // Step 1: Direct match by orders_v2.product_id
  // Prefer orders with tariff_id (full product purchase) over module-only orders
  const { data: directOrders, error: directErr } = await supabase
    .from('orders_v2')
    .select('id, tariff_id, purchase_snapshot')
    .eq('user_id', userId)
    .eq('product_id', targetProductId)
    .eq('status', 'paid')
    .neq('id', excludeOrderId)
    .order('tariff_id', { ascending: false, nullsFirst: false })
    .limit(5);

  if (directErr) {
    console.error('[check-prior-purchase] Direct query error:', directErr.message);
  }

  // Pick best: prefer order with tariff_id (full purchase)
  const directOrder = (directOrders || []).find((o: any) => o.tariff_id)
    || (directOrders || [])[0]
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
  // Only for historical_purchase_type = 'module_only_standalone'
  // Only when module_list_mapped contains exactly 1 UUID matching targetProductId
  // Use JSONB containment for efficient server-side filtering
  const { data: moduleOrders, error: moduleErr } = await supabase
    .from('orders_v2')
    .select('id, tariff_id, purchase_snapshot')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .neq('id', excludeOrderId)
    .eq('purchase_snapshot->>historical_purchase_type', 'module_only_standalone')
    .contains('purchase_snapshot', { module_list_mapped: [targetProductId] })
    .limit(5);

  if (moduleErr) {
    console.error('[check-prior-purchase] Module fallback query error:', moduleErr.message);
    return NOT_FOUND;
  }

  for (const order of (moduleOrders || [])) {
    const snapshot = order.purchase_snapshot as Record<string, any> | null;
    if (!snapshot) continue;

    // Double-check: must have module_list_mapped with exactly 1 UUID
    const moduleList = snapshot.module_list_mapped;
    if (!Array.isArray(moduleList)) continue;
    if (moduleList.length !== 1) continue; // multi-module → manual_review, skip

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
