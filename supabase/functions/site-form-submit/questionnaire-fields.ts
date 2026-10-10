import { validateConfiguredPhoneAnswers } from "../_shared/phone-validation.ts";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);

export interface QuestionnaireAnswers {
  formData: Record<string, string>;
  fieldMapping: Record<string, string>;
  mappedValues: Record<string, string>;
  email: string;
}

/** Values come from the browser; labels, types and CRM mappings come only from the saved form. */
export function validateQuestionnaireAnswers(config: unknown, submitted: unknown, verifiedEmail: string): QuestionnaireAnswers {
  if (!Array.isArray(config) || !Array.isArray(submitted) || config.length === 0 || config.length > 100 || submitted.length !== config.length) {
    throw new Error("questionnaire_fields_invalid");
  }
  const formData: Record<string, string> = Object.create(null);
  validateConfiguredPhoneAnswers(config, submitted);
  const fieldMapping: Record<string, string> = Object.create(null);
  const mappedValues: Record<string, string> = Object.create(null);
  let email = "";
  for (let i = 0; i < config.length; i++) {
    const field = config[i];
    const answer = submitted[i];
    if (!record(field) || !record(answer) || typeof field.label !== "string" || !field.label.trim() ||
        !["text", "email", "phone", "textarea"].includes(String(field.type)) ||
        answer.label !== field.label || answer.type !== field.type ||
        (answer.mapping || "none") !== (field.mapping || "none") || typeof answer.value !== "string" ||
        Object.prototype.hasOwnProperty.call(formData, field.label)) throw new Error("questionnaire_fields_invalid");
    const value = answer.value.trim();
    if ((field.required === true && !value) || value.length > (field.type === "textarea" ? 10_000 : 1000)) {
      throw new Error("questionnaire_answer_invalid");
    }
    formData[field.label] = value;
    if (typeof field.mapping === "string" && field.mapping !== "none") {
      if (Object.prototype.hasOwnProperty.call(mappedValues, field.mapping)) throw new Error("questionnaire_mapping_ambiguous");
      fieldMapping[field.label] = field.mapping;
      mappedValues[field.mapping] = value;
    }
    if (field.type === "email" || field.mapping === "email") {
      if (email) throw new Error("questionnaire_email_ambiguous");
      email = value.toLowerCase();
    }
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email !== verifiedEmail.trim().toLowerCase()) {
    throw new Error("questionnaire_email_mismatch");
  }
  return { formData, fieldMapping, mappedValues, email };
}
