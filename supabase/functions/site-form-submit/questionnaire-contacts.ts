/** The saved form remains the source of labels, validation and CRM mappings. */
export const QUESTIONNAIRE_CONTACT_MAPPINGS = ["full_name", "first_name", "last_name", "email", "phone", "instagram", "instagram_url"] as const;
export function isQuestionnaireContactField(field: { type?: unknown; mapping?: unknown }): boolean {
  return field.type === "email" || field.type === "phone" ||
    QUESTIONNAIRE_CONTACT_MAPPINGS.some(mapping => mapping === field.mapping);
}
