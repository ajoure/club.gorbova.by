/** Explicit mapped UUID components are purchase facts, including split children. */
export const HISTORICAL_COMPONENT_TYPES = ['module_only_standalone', 'module_child_purchase', 'base_tariff_purchase'];

export function hasHistoricalComponent(snapshot: Record<string, any> | null, productId: string): boolean {
  return !!snapshot && HISTORICAL_COMPONENT_TYPES.includes(snapshot.historical_purchase_type)
    && Array.isArray(snapshot.module_list_mapped) && snapshot.module_list_mapped.includes(productId);
}

export function isModuleOnlyHistory(type: unknown): boolean {
  return type === 'module_only_standalone' || type === 'module_child_purchase';
}
