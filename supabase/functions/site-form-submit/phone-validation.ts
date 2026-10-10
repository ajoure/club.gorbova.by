/** Existing platform rule, shared by browser fields and server submission paths. */
export function isValidPhoneNumber(value: string): boolean {
  if (!/^[+\d\s().-]+$/.test(value)) return false;
  const cleaned = value.replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(cleaned);
}

export const PHONE_VALIDATION_MESSAGE = "Введите телефон с кодом страны: от 8 до 15 цифр, например +375291234567.";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Saved field types identify phone answers even if a caller disguises their type. */
export function validateConfiguredPhoneAnswers(config: unknown, submitted: unknown): void {
  if (!Array.isArray(submitted)) throw new Error("phone_invalid");
  const configuredPhones = Array.isArray(config) ? config.filter(field => record(field) &&
    (field.type === "phone" || field.mapping === "phone")) : [];
  for (const field of configuredPhones) {
    const matches = submitted.filter(answer => record(answer) && answer.label === field.label);
    if (matches.length > 1 || (field.required === true && matches.length !== 1)) throw new Error("phone_invalid");
    const value = matches[0]?.value;
    if ((field.required === true && !value) || (value !== undefined && value !== "" &&
        (typeof value !== "string" || !isValidPhoneNumber(value)))) throw new Error("phone_invalid");
  }
  // Legacy mappings must not be able to inject a malformed phone into a contact.
  for (const answer of submitted) {
    if (record(answer) && (answer.type === "phone" || answer.mapping === "phone") &&
        answer.value !== undefined && answer.value !== "" &&
        (typeof answer.value !== "string" || !isValidPhoneNumber(answer.value))) throw new Error("phone_invalid");
  }
}
