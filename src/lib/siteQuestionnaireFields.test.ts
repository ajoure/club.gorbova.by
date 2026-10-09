import { describe, expect, it } from "vitest";
import { validateQuestionnaireAnswers } from "../../supabase/functions/site-form-submit/questionnaire-fields";

const config = [
  { label: "Почта", type: "email", mapping: "email", required: true },
  { label: "Комментарий", type: "textarea", required: true },
];
const answers = [
  { label: "Почта", type: "email", mapping: "email", value: " Person@Example.com " },
  { label: "Комментарий", type: "textarea", mapping: "none", value: " Мой ответ " },
];
describe("server questionnaire identity and schema", () => {
  it("retains all answers and only saved CRM mappings for the verified email", () => {
    const result = validateQuestionnaireAnswers(config, answers, "person@example.com");
    expect(result.formData).toEqual({ Почта: "Person@Example.com", Комментарий: "Мой ответ" });
    expect(result.fieldMapping).toEqual({ Почта: "email" });
    expect(result.mappedValues).toEqual({ email: "Person@Example.com" });
  });
  it("rejects mapping injection, altered labels, omitted and extra answers", () => {
    for (const invalid of [
      [{ ...answers[0], mapping: "full_name" }, answers[1]],
      [answers[0], { ...answers[1], label: "Другая анкета" }],
      answers.slice(0, 1), [...answers, answers[1]],
    ]) expect(() => validateQuestionnaireAnswers(config, invalid, "person@example.com")).toThrow("questionnaire_fields_invalid");
  });
  it("never attaches answers to a different verified person", () => {
    expect(() => validateQuestionnaireAnswers(config, answers, "other@example.com")).toThrow("questionnaire_email_mismatch");
  });
  it("rejects blank required and oversized answers without silently truncating", () => {
    for (const value of [" ", "x".repeat(10_001)]) {
      expect(() => validateQuestionnaireAnswers(config, [answers[0], { ...answers[1], value }], "person@example.com")).toThrow("questionnaire_answer_invalid");
    }
  });
  it("rejects ambiguous duplicate labels instead of overwriting history", () => {
    expect(() => validateQuestionnaireAnswers([config[0], config[0]], [answers[0], answers[0]], "person@example.com")).toThrow("questionnaire_fields_invalid");
  });
});
