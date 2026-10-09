import { describe, expect, it } from "vitest";
import { questionnaireThankYouUrl } from "./questionnaireThankYouUrl";
describe("questionnaire thank-you redirect", () => {
  it("keeps the configured thank-you page in the same authenticated origin", () => {
    expect(questionnaireThankYouUrl("/predzapiscb21anketathanks", "https://gorbova.by")).toBe("/predzapiscb21anketathanks");
    expect(questionnaireThankYouUrl("https://gorbova.by/thanks?src=telegram", "https://gorbova.by")).toBe("/thanks?src=telegram");
  });
  it("rejects external, script and credential URLs", () => {
    for (const value of ["//other.example/thanks", "https://other.example/thanks", "javascript:alert(1)", "https://someone:secret@gorbova.by/thanks", null])
      expect(questionnaireThankYouUrl(value, "https://gorbova.by")).toBeNull();
  });
});
