import { describe, expect, it } from "vitest";
import { isValidPhoneNumber, validateConfiguredPhoneAnswers } from "../../supabase/functions/_shared/phone-validation";
import { validateQuestionnaireAnswers } from "../../supabase/functions/site-form-submit/questionnaire-fields";

const config = [{ label: "Телефон", type: "phone", mapping: "phone", required: true }];
const answer = (value: unknown, type = "phone") => [{ label: "Телефон", type, mapping: "phone", value }];
describe("site phone validation", () => {
  it.each(["+375 (29) 123-45-67", "+48123456789", "+12345678", "+123456789012345"])("accepts formatted international number %s", value => {
    expect(isValidPhoneNumber(value)).toBe(true);
    expect(() => validateConfiguredPhoneAnswers(config, answer(value))).not.toThrow();
  });
  it.each(["1", "+1", "+1234567", "+1234567890123456", "123456789", "+375abc123456789", "++375291234567"])("rejects malformed number %s", value => {
    expect(isValidPhoneNumber(value)).toBe(false);
    expect(() => validateConfiguredPhoneAnswers(config, answer(value))).toThrow("phone_invalid");
  });
  it("rejects disguised, omitted, duplicate and non-string required answers", () => {
    for (const submitted of [answer("1", "text"), [], [...answer("+375291234567"), ...answer("+375291234567")], answer(1)]) {
      expect(() => validateConfiguredPhoneAnswers(config, submitted)).toThrow("phone_invalid");
    }
  });
  it("keeps optional blank phones and non-phone forms working", () => {
    expect(() => validateConfiguredPhoneAnswers([{ ...config[0], required: false }], answer(""))).not.toThrow();
    expect(() => validateConfiguredPhoneAnswers([{ label: "Возраст", type: "text" }], [{ label: "Возраст", value: "1" }])).not.toThrow();
  });
  it("rejects a spoofed legacy phone mapping without trusting saved labels", () => {
    expect(() => validateConfiguredPhoneAnswers([], [{ label: "Другое", mapping: "phone", value: "1" }])).toThrow("phone_invalid");
  });
  it("questionnaire validation rejects a phone before creating canonical form data", () => {
    const fields = [...config, { label: "Email", type: "email", mapping: "email", required: true }];
    expect(() => validateQuestionnaireAnswers(fields, [...answer("1"), { ...fields[1], value: "test@example.com" }], "test@example.com")).toThrow("phone_invalid");
  });
});
