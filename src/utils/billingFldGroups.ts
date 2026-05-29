/**
 * billingFldGroups — Sprint 3G.
 *
 * SOT: `fields_registry.entity_type` определяет принадлежность FLD-поля
 * к биллинговой группе. В package-шаблонах биллинговые FLD должны
 * подсвечиваться как warning, остальные — допустимы как valid.
 *
 * Канонический список биллинговых entity_type:
 *   • customer, customer_ent, customer_ind, customer_leg, customer_signer
 *   • executor, executor_leg
 *
 * Системные/документные FLD (entity_type ∈ {system, document, meeting,
 * agenda, decision, package, person, legal_details, deal, payment,
 * product, tariff, offer, contact, entity, entity_person, user_requisites})
 * считаются нейтральными и допустимы в package-template без warning.
 */
export const BILLING_FLD_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "customer",
  "customer_ent",
  "customer_ind",
  "customer_leg",
  "customer_signer",
  "executor",
  "executor_leg",
]);

export function isBillingEntityType(entityType: string | null | undefined): boolean {
  if (!entityType) return false;
  return BILLING_FLD_ENTITY_TYPES.has(entityType);
}
