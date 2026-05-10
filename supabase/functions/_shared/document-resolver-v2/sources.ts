// ============================================================================
// document-resolver-v2 / sources.ts
// PATCH E.2. Source priority map. Higher wins. equal-priority within the same
// (scope, subject_type, label) → conflict. equal-priority across different
// scope → label_collision_cross_scope warning, NOT blocking.
// ============================================================================

export type ResolverSource =
  | 'manual_override'
  | 'computed'
  | 'legal_entities_requisites'
  | 'individual_requisites'
  | 'executor'
  | 'system_customer'
  | 'order_meta'
  | 'document_meta'
  | 'legacy_client_legal_details'
  | 'unmapped';

export const SOURCE_PRIORITY: Record<ResolverSource, number> = {
  manual_override: 100,
  computed: 80,
  legal_entities_requisites: 60,
  individual_requisites: 60,
  executor: 50,
  system_customer: 50,
  order_meta: 30,
  document_meta: 30,
  legacy_client_legal_details: 10,
  unmapped: 0,
};
