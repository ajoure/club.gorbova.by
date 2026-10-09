import { expect, it } from "vitest";
import { questionnairePersonalChatUrl } from "./questionnairePersonalChat";
it("uses the existing business chat with its draft instead of a share dialog or channel invite", () => {
  expect(questionnairePersonalChatUrl("https://t.me/m/fixtureSlug")).toBe("https://t.me/m/fixtureSlug");
  for (const url of ["https://t.me/+invite", "https://t.me/share?text=hello", "https://other.example/m/slug", "javascript:alert(1)"])
    expect(questionnairePersonalChatUrl(url)).toBeNull();
});
